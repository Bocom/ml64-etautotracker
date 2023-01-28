import { ILoggerLevels, IModLoaderAPI, IPlugin } from 'modloader64_api/IModLoaderAPI';
import * as net from 'net'

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

export default class PluginName implements IPlugin {
    ModLoader = {} as IModLoaderAPI;

    constructor() {}

    preinit() {}
    init() {}
    postinit() {
        this.connect();
    }
    onTick(_frame: number) {}

    connect() {
        this.ModLoader.logger.info("Connecting to EmoTracker on port 43884");
        const client = net.createConnection({ port: 43884 }, () => {
            this.ModLoader.logger.info("Connected!");
        });

        const sizeBytesCount = 4;
        let messageSize = 0;

        // TODO: Handle EmoTracker not being open when it starts.
        // TODO: Reconnection loop

        client.on('readable', () => {
            // The EmoTracker packet format is as follows
            // <a><b><c><d><data>
            // a, b, c and d is the size of the data as single ASCII characters.
            // data is a JSON object containing the command

            if (messageSize === 0) {
                const chunk: Buffer = client.read(sizeBytesCount);

                if (chunk === null) {
                    return;
                }

                const a = chunk[0] << 24;
                const b = chunk[1] << 16;
                const c = chunk[2] << 8;
                const d = chunk[3];

                messageSize = a | b | c | d;
            }

            if (messageSize !== 0) {
                const messageChunk: Buffer = client.read(messageSize);
                if (messageChunk === null) {
                    return;
                }

                this.ModLoader.logger.debug(`-> ${messageChunk.toString()}`);

                const data = JSON.parse(messageChunk.toString()) as Command;

                this.handleCommand(client, data);

                messageSize = 0;
            }
        });
    }

    handleCommand(client: net.Socket, command: Command) {
        const commandType = command.type as CommandType;

        const retval: Response = {
            id: command.id,
            stamp: Date.now(),
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
        } else if (commandType === CommandType.ReadByte) {
            // this.ModLoader.logger.info(`Reading byte at ${command.address}`);
            retval.value = this.ModLoader.emulator.rdramRead8(command.address!);
            // this.ModLoader.logger.debug(retval.value.toString());
        } else if (commandType === CommandType.ReadUshort) {
            // this.ModLoader.logger.info(`Reading ushort at ${command.address}`);
            retval.value = this.ModLoader.emulator.rdramRead16(command.address!);
            // this.ModLoader.logger.debug(retval.value.toString());
        } else if (commandType === CommandType.Message) {
            this.ModLoader.logger.info(command.message!);
        } else if (commandType === CommandType.ReadBlock) {
            // this.ModLoader.logger.info(`Reading ${command.value} bytes from ${command.address}`);
            const bytes = this.ModLoader.emulator.rdramReadBuffer(command.address!, command.value!);
            let result = '';
            for (const byte of bytes.values()) {
                result += String.fromCharCode(byte);
            }
            retval.block = btoa(result);
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

        this.ModLoader.logger.debug(`<- ${data}`);

        client.write(`${a}${b}${c}${d}${data}`);
    }
}
