import { IModLoaderAPI, IPlugin } from 'modloader64_api/IModLoaderAPI';
import * as net from 'net';
import * as base64 from 'base64-arraybuffer';

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

export default class ETAutoTracker implements IPlugin {
    ModLoader = {} as IModLoaderAPI;

    pluginName: 'ETAutoTracker';

    commands: Buffer[];

    client: net.Socket;

    constructor() {
        this.commands = [];
    }

    preinit() {}
    init() {}
    postinit() {
        this.connect();
    }
    onTick(_frame: number) {
        if (this.client === null || !this.client.writable) {
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
        this.ModLoader.logger.info("Connecting to EmoTracker on port 43884");

        this.client = net.createConnection(43884);
        this.client.setNoDelay(true);

        this.client.on('connect', () => this.ModLoader.logger.info('Connected!'));

        const sizeBytesCount = 4;
        let messageSize: number = 0;

        // TODO: Handle EmoTracker not being open when it starts.
        // TODO: Reconnection loop

        this.client.on('readable', () => {
            // The EmoTracker packet format is as follows
            // <a><b><c><d><data>
            // a, b, c and d is the size of the data as single bytes meant to be OR'd together.
            // data is a JSON object containing the command

            while (true) {
                if (messageSize === 0) {
                    const chunk: Buffer = this.client.read(sizeBytesCount);
                    if (chunk === null) {
                        break;
                    }

                    const a = chunk[0] << 24;
                    const b = chunk[1] << 16;
                    const c = chunk[2] << 8;
                    const d = chunk[3];

                    messageSize = a | b | c | d;
                }

                if (messageSize !== 0) {
                    const messageChunk: Buffer = this.client.read(messageSize);
                    if (messageChunk === null) {
                        break;
                    }

                    this.commands.push(messageChunk);

                    messageSize = 0;
                }
            }
        });
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

            this.ModLoader.logger.info(`EmoTracker version ${major}.${minor}.${patch}`);

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

        const array = new Uint8Array(length + 4);
        array[0] = (length >> 24) & 0xFF;
        array[1] = (length >> 16) & 0xFF;
        array[2] = (length >> 8) & 0xFF;
        array[3] = length & 0xFF;
        for (let i = 0; i < length; i++) {
            array[4 + i] = data.charCodeAt(i);
        }

        this.client.write(array);
    }
}
