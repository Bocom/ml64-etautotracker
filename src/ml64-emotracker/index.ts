import { ILoggerLevels, IModLoaderAPI, IPlugin } from 'modloader64_api/IModLoaderAPI';
import * as net from 'net'

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

                // TODO: parse command

                messageSize = 0;
            }
        });
    }
}
