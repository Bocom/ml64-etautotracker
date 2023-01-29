import { IModLoaderAPI, IPlugin } from 'modloader64_api/IModLoaderAPI';
import net from 'net';
import base64 from 'base64-arraybuffer';
import { StateMachine } from './StateMachine';

enum CommandType {
    ReadByte = 0x00,
    ReadUshort = 0x01,
    ReadUint = 0x02,
    ReadBlock = 0x0F,
    WriteByte = 0x10,
    WriteUshort = 0x11,
    WriteUint = 0x12,
    WriteBlock = 0x1F,
    AtomicBitFlip = 0x20,
    AtomicBitUnflip = 0x21,
    MemoryFreezeUnsigned = 0x30,
    MemoryUnfreeze = 0x3F,
    LoadRom = 0xE0,
    UnloadRom = 0xE1,
    GetRomPath = 0xE2,
    GetEmulatorCoreId = 0xE3,
    Message = 0xF0,
    DoNothing = 0xFF,
};

interface Command {
    id: number;
    type: CommandType;
    domain?: string;
    address?: number;
    value?: number;
    size?: number;
    message?: string;
}

interface Response {
    id: number,
    stamp: number,
    type: number,
    message: string,
    address: number,
    size: number,
    domain: string,
    value: number,
    block?: string,
}

const SIZE_BYTE_COUNT = 4;
const ET_HOST = 'localhost';
const ET_PORT = 43884;
const ET_RETRY_TIMEOUT = 5000;

const STATE_CONNECTING = Symbol();
const STATE_CONNECTED = Symbol();
const STATE_EXIT = Symbol();

export default class ETAutoTracker implements IPlugin {
    ModLoader = {} as IModLoaderAPI;

    pluginName: 'ETAutoTracker';

    client: net.Socket;

    stateMachine: StateMachine;

    commands: Buffer[];

    messageSize: number = 0;

    constructor() {
        this.commands = [];
        this.stateMachine = new StateMachine();

        this.stateMachine.registerState(STATE_CONNECTING, {
            onEnter: () => this.connect(),
        });
        this.stateMachine.registerState(STATE_CONNECTED, {
            onTick: () => this.stateTick(),
            onExit: () => this.client.destroy(),
        });
        this.stateMachine.registerState(STATE_EXIT, {
            onEnter: () => this.client.destroy(),
        });
    }

    preinit() {}
    init() {}
    postinit() {
        this.stateMachine.setState(STATE_CONNECTING);
    }
    onTick(_frame: number) {
        this.stateMachine.tick();
    }

    stateTick() {
        if (!this.client.writable) {
            this.ModLoader.logger.error('Lost connection, reconnecting...');
            this.stateMachine.setState(STATE_CONNECTING);
            return;
        }

        if (this.commands.length === 0) {
            return;
        }

        const commandData = this.commands.shift()!;
        const command = JSON.parse(commandData.toString()) as Command;

        const response = this.handleCommand(command);
        this.sendResponse(response);
    }

    connect() {
        this.ModLoader.logger.info(`Connecting to EmoTracker on port ${ET_PORT}`);

        this.client = net.createConnection({
            host: ET_HOST,
            port: ET_PORT,
        });

        this.client.setNoDelay(true);

        this.client.on('connect', () => {
            this.ModLoader.logger.info('Connected!');

            this.stateMachine.setState(STATE_CONNECTED);
        });

        this.client.on('error', (err) => {
            this.ModLoader.logger.error(err.message);

            setTimeout(() => {
                if (this.stateMachine.currentStateName === STATE_CONNECTING) {
                    this.connect();
                } else {
                    this.stateMachine.setState(STATE_CONNECTING)
                }
            }, ET_RETRY_TIMEOUT);
        });

        this.client.on('readable', () => this.handleData());
    }

    handleData() {
        // The EmoTracker packet format is as follows
        // <a><b><c><d><data>
        // a, b, c and d is the size of the data as single bytes meant to be OR'd together.
        // data is a JSON object containing the command

        while (true) {
            if (this.messageSize === 0) {
                try {
                    const chunk: Buffer = this.client.read(SIZE_BYTE_COUNT);
                    if (chunk === null) {
                        break;
                    }

                    const a = chunk[0] << 24;
                    const b = chunk[1] << 16;
                    const c = chunk[2] << 8;
                    const d = chunk[3];

                    this.messageSize = a | b | c | d;
                } catch (e) {
                    this.ModLoader.logger.error(e);
                }
            }

            if (this.messageSize !== 0) {
                try {
                    const messageChunk: Buffer = this.client.read(this.messageSize);
                    if (messageChunk === null) {
                        break;
                    }

                    this.commands.push(messageChunk);

                    this.messageSize = 0;
                } catch (e) {
                    this.ModLoader.logger.error(e);
                }
            }
        }
    }

    handleCommand(command: Command): Response {
        const commandType = command.type as CommandType;

        const response: Response = {
            id: command.id,
            stamp: Math.floor(Date.now() / 1000),
            type: command.type,
            message: '',
            address: command.address!,
            size: command.size!,
            domain: command.domain!,
            value: command.value!,
        };

        if (commandType === CommandType.GetEmulatorCoreId) {
            const value = command.value!;
            const major = (value >> 16) & 0xFF;
            const minor = (value >> 8) & 0xFF;
            const patch = value & 0xFF;

            // Technically not the version of EmoTracker
            this.ModLoader.logger.info(`EmoTracker pack version ${major}.${minor}.${patch}`);

            response.message = 'N64'; // TODO: Support other supported emulators later?
        } else if (commandType === CommandType.ReadByte) {
            response.value = this.ModLoader.emulator.rdramRead8(command.address!);
        } else if (commandType === CommandType.ReadUshort) {
            response.value = this.ModLoader.emulator.rdramRead16(command.address!);
        } else if (commandType === CommandType.ReadBlock) {
            const bytes = this.ModLoader.emulator.rdramReadBuffer(command.address!, command.value!);

            response.block = base64.encode(bytes);
        } else if (commandType === CommandType.Message) {
            this.ModLoader.logger.info(command.message!);
        } else if (commandType === CommandType.DoNothing) {
            //
        } else {
            this.ModLoader.logger.error(`Unhandled command type '${CommandType[command.type]}'`);
        }

        return response;
    }

    sendResponse(response: Response) {
        const data = JSON.stringify(response);
        const length = data.length;

        const array = new Uint8Array(length + SIZE_BYTE_COUNT);
        array[0] = (length >> 24) & 0xFF;
        array[1] = (length >> 16) & 0xFF;
        array[2] = (length >> 8) & 0xFF;
        array[3] = length & 0xFF;
        for (let i = 0; i < length; i++) {
            array[SIZE_BYTE_COUNT + i] = data.charCodeAt(i);
        }

        this.client.write(array);
    }
}
