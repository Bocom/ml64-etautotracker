import { ILoggerLevels, IModLoaderAPI, IPlugin } from 'modloader64_api/IModLoaderAPI';
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

function atl(address: number) {
    return {
        1943144: "Live Chest Data 1",
        1943146: "Live Chest Data 2",
        1161516: "Game Mode 1",
        1161519: "Game Mode 2",
        1156588: "File Validation String",
        4197564: "Rando FREE_SCARECROW_ENABLED",
        1156610: "Magic Meter Data",
        1156622: "Biggoron Data",
        1156674: "Item Data 1",
        1156714: "Item Data 2",
        1156721: "Quest Data",
        1156751: "Key Data",
        1156772: "Save Context Dungeons 1",
        1156856: "Save Context Dungeons 2",
        1156940: "Save Context Dungeons 3",
        1157024: "Save Context Dungeons 4",
        1157108: "Save Context Dungeons 5",
        1158020: "Save Context Shops",
        1158228: "Save Context Overworld 1",
        1158928: "Save Context Overworld 2",
        1160300: "Skulltula Data",
        1160332: "INF Tables",
        1876424: "Global Context Switch Data",
        1876440: "Global Context Chest Data",
        1876452: "Global Context Collectible Data",
    }[address] ?? `Unknown address ${address}`;
}

export default class PluginName implements IPlugin {
    ModLoader = {} as IModLoaderAPI;

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
        if (this.client === null) {
            return;
        }

        if (this.commands.length === 0) {
            return;
        }

        this.ModLoader.logger.info(`queue length = ${this.commands.length}`);

        this.handleCommand(JSON.parse(this.commands.shift()!.toString()) as Command);
    }

    connect() {
        this.ModLoader.logger.info("Connecting to EmoTracker on port 43884");
        this.client = net.createConnection(43884);

        this.client.on('connect', () => this.ModLoader.logger.info('Connected!'));

        this.client.setNoDelay(true);

        const sizeBytesCount = 4;
        let messageSize = 0;

        // TODO: Handle EmoTracker not being open when it starts.
        // TODO: Reconnection loop

        this.client.on('readable', () => {
            // The EmoTracker packet format is as follows
            // <a><b><c><d><data>
            // a, b, c and d is the size of the data as single ASCII characters.
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
                        console.log(`messageChunk null ${messageSize} ${this.client.bytesRead}`);
                        break;
                    }

                    // this.ModLoader.logger.debug(`-> ${messageChunk.toString()}`);

                    this.commands.push(messageChunk);

                    messageSize = 0;
                }
            }
        });
    }

    handleCommand(command: Command) {
        const commandType = command.type as CommandType;

        const retval: Response = {
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

            // retval.message = 'SNES'; // coavins' Hamsda autotracker fork uses SNES for some reason
            retval.message = 'N64'; // PugHUD uses N64
            retval.value = 131584;
        } else if (commandType === CommandType.ReadByte) {
            // this.ModLoader.logger.info(`Reading byte at ${command.address}`);
            // this.ModLoader.logger.debug(atl(command.address!));

            retval.value = this.ModLoader.emulator.rdramRead8(command.address!);
            // this.ModLoader.logger.debug(retval.value.toString());
        } else if (commandType === CommandType.ReadUshort) {
            // this.ModLoader.logger.info(`Reading ushort at ${command.address}`);
            // this.ModLoader.logger.debug(atl(command.address!));

            retval.value = this.ModLoader.emulator.rdramRead16(command.address!);
            // this.ModLoader.logger.debug(retval.value.toString());
        } else if (commandType === CommandType.Message) {
            this.ModLoader.logger.info(command.message!);
        } else if (commandType === CommandType.ReadBlock) {
            // this.ModLoader.logger.info(`Reading ${command.value} bytes from ${command.address}`);
            // this.ModLoader.logger.debug(atl(command.address!));

            this.ModLoader.logger.info(command.address!.toString(), command.value!.toString());

            const bytes = this.ModLoader.emulator.rdramReadBuffer(command.address!, command.value!);

            let result = '';
            for (const byte of bytes.values()) {
                result += String.fromCharCode(byte);
            }

            retval.block = btoa(result);
            // retval.block = base64.encode(bytes);
        } else if (commandType === CommandType.DoNothing) {
            //
        } else {
            this.ModLoader.logger.error(`Unhandled command type '${CommandType[command.type]}'`);
        }

        let data = JSON.stringify(retval);
        let length = data.length;

        const a = String.fromCharCode((length >> 24) & 0xFF);
        const b = String.fromCharCode((length >> 16) & 0xFF);
        const c = String.fromCharCode((length >> 8) & 0xFF);
        const d = String.fromCharCode(length & 0xFF);

        // this.ModLoader.logger.debug(`<- ${data}`);

        const sent = this.client.write(`${a}${b}${c}${d}${data}`);
        this.ModLoader.logger.debug(`${command.id} sent = ${sent ? 'yes' : 'no'}`);
    }
}
