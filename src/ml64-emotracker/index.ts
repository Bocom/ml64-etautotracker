import { ILoggerLevels, IModLoaderAPI, IPlugin } from 'modloader64_api/IModLoaderAPI';

export default class PluginName implements IPlugin {
    ModLoader = {} as IModLoaderAPI;

    constructor() {}

    preinit() {}
    init() {}
    postinit() {}
    onTick(frame: number) {}
}
