'use strict';
let nconf = require('nconf');

module.exports = {
    ConfigBuilder: ConfigBuilder,
    ConfigAPI: ConfigAPI
};

function ConfigAPI() {
    let cfg = new nconf.Provider();
    cfg.argv().env();
    this._configProvider = cfg;
}

ConfigAPI.prototype.get = function (key) {
    return this._configProvider.get(key);
};
ConfigAPI.prototype.set = function (key, value) {
    return this._configProvider.set(key, value);
};
ConfigAPI.prototype.loadFile = function (fileKey, file) {
    this._configProvider.file(fileKey, file);
};

ConfigAPI.createInstance = function() {
    return new ConfigAPI();
};

function ConfigBuilder(configApi) {
    this._configApi = configApi;
}

ConfigBuilder.prototype.build = function (rootDir) {

    (function validate(rootDir) {
        if (null === rootDir || undefined === rootDir || '' === rootDir) {
            throw new Error('Valid root path expected. rootDir[' + rootDir + ']');
        }
    })(rootDir);

    let configStore = {};

    this._configApi.loadFile('root_secure', rootDir +  '/config_secure.json');
    this._configApi.loadFile('root', rootDir + '/config.json');

    configStore['root'] = this._configApi;

    let appList = this._configApi.get('applications');
    let appStartList = this._configApi.get('application') + ';';

    for (let appKey in appList) {
        let appCfg = {};
        appCfg.appName = appKey;
        appCfg.appPath = rootDir + '/' + appList[appCfg.appName];
        appCfg.appCommonPath = rootDir + '/apps/common';

        let appCfgApi = ConfigAPI.createInstance();

        appCfgApi.loadFile('app_secure', appCfg.appPath +  '/config_secure.json');
        appCfgApi.loadFile('app', appCfg.appPath + '/config.json');

        appCfgApi.loadFile('common_secure', appCfg.appCommonPath +  '/config_secure.json');
        appCfgApi.loadFile('common', appCfg.appCommonPath + '/config.json');

        appCfgApi.loadFile('root_secure', rootDir +  '/config_secure.json');
        appCfgApi.loadFile('root', rootDir + '/config.json');


        configStore[appKey] = appCfgApi;
    }

    return configStore;

};
