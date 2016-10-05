/* Copyright 2012-2013 Sam Elsamman
 Permission is hereby granted, free of charge, to any person obtaining
 a copy of this software and associated documentation files (the
 "Software"), to deal in the Software without restriction, including
 without limitation the rights to use, copy, modify, merge, publish,
 distribute, sublicense, and/or sell copies of the Software, and to
 permit persons to whom the Software is furnished to do so, subject to
 the following conditions:

 The above copyright notice and this permission notice shall be
 included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
/*  @type RemoteObjectTemplate */
var ObjectTemplate = require("supertype");
var RemoteObjectTemplate = require("semotus");
RemoteObjectTemplate.maxCallTime = 60 * 1000; // Max time for call interlock
var PersistObjectTemplate = require("persistor")(ObjectTemplate, RemoteObjectTemplate, ObjectTemplate);
var os = require('os');
var hostName = os.hostname();
var formidable = require('formidable');
var UglifyJS = require('uglify-js');
var url = require('url');
var fs = require('fs');
var Q = require('q');
var logLevel = 1;
var path = require('path');
var onDeath = require('death');
var deathWatch = [];
var sendToLog = null;
onDeath(function () {
    console.log("exiting gracefully " + deathWatch.length + " tasks to perform");
    return Q()
        .then(function () {
            return deathWatch.reduce(function(p, task) {
                return p.then(task)
            }, Q(true));
        }).then(function () {
            console.log("All done");
            return Q.delay(1000);
        }).then(function () {
            process.exit(0);
        }).fail(function (e){
            console.log("on death caught exception: " + e.message + e.stack);
        });
});
var applicationConfig = {};
var applicationSource = {};
var applicationSourceMap = {};
var deferred = {};
var logger = null;
var zlib = require('zlib');
var amorphicOptions = {
    performanceLogging: false,
    compressSession: false,
    compressXHR: true,
    sourceMode: 'prod'
}

function establishApplication (appPath, path, cpath, initObjectTemplate, sessionExpiration, objectCacheExpiration, sessionStore, loggerCall, appVersion, appConfig, logLevel) {
    applicationConfig[appPath] = {
        appPath: path,
        commonPath: cpath,
        initObjectTemplate: initObjectTemplate,
        sessionExpiration: sessionExpiration,
        objectCacheExpiration: objectCacheExpiration,
        sessionStore: sessionStore,
        appVersion: appVersion,
        appConfig: appConfig,
        logLevel: logLevel || 'info'
    };
    logger = loggerCall ? loggerCall : logger;
    log(1, "", "semotus extablishing application for " + appPath);

    if (amorphicOptions.sourceMode != 'debug' && !appConfig.isDaemon) {
        var config = applicationConfig[appPath];
        var controllerPath = config.appPath + "controller.js";
        controllerPath.match(/(.*?)([0-9A-Za-z_]*)\.js$/)
        var prop = RegExp.$2
        var objectTemplate = require("persistor")(ObjectTemplate, RemoteObjectTemplate, RemoteObjectTemplate);
        applicationSource[appPath] = "";
        applicationSourceMap[appPath] = "";
        initObjectTemplate(objectTemplate);
        getTemplates(objectTemplate, config.appPath, [prop + ".js"], config, appPath, true);
    }
}
function establishDaemon (path) {
    // Retrieve configuration information
    var config = applicationConfig[path];
    if (!config)
        throw  new Error("Semotus: establishServerSession called with a path of " + path + " which was not registered");
    var initObjectTemplate = config.initObjectTemplate;
    var controllerPath = config.appPath + "controller.js";

    var requires = {};
    controllerPath.match(/(.*?)([0-9A-Za-z_]*)\.js$/)
    var prop = RegExp.$2

    // Create a new unique object template utility
    var objectTemplate = require("persistor")(ObjectTemplate, null, ObjectTemplate);

    // Inject into it any db or persist attributes needed for application
    initObjectTemplate(objectTemplate);
    var requires = getTemplates(objectTemplate, config.appPath, [prop + ".js"], config, path);

    var controllerTemplate = requires[prop].Controller;
    if (!controllerTemplate)
        throw  new Error("Missing controller template in " + prefix + prop + ".js");
    controllerTemplate.objectTemplate = objectTemplate;

    var controller = new controllerTemplate();
    objectTemplate.controller = controller;

    controller.serverInit();
}
/**
 * Establish a server session

 * The entire session mechanism is predicated on the fact that there is a unique instance
 * of object templates for each session.
 *
 * @param req
 * @param path - used to identify future requests from XML
 * @param newPage - force returning everything since this is likely a session continuation on a new web page
 * @param reset - create new clean empty controller losing all data
 * @param hasReset - client has reset and is sending a controller
 * @return {*}
 */
function establishServerSession (req, path, newPage, reset, newControllerId)
{
    // Retrieve configuration information
    var config = applicationConfig[path];
    if (!config)
        throw  new Error("Semotus: establishServerSession called with a path of " + path + " which was not registered");
    var initObjectTemplate = config.initObjectTemplate;
    var controllerPath = config.appPath + "/controller.js";
    var objectCacheExpiration = config.objectCacheExpiration;
    var sessionExpiration = config.sessionExpiration;
    var sessionStore = config.sessionStore;
    var appVersion = config.appVersion;
    var session = req.session;

    // For a new page determine if a controller is to be omitted
    if (newPage == "initial" && config.appConfig.createControllerFor && !session.semotus)
    {
        var referer = req.headers['referer'] ? url.parse(req.headers['referer'], true).path : "";
        var match = config.appConfig.createControllerFor;
        if (!referer.match(match) && match != "yes")
        {
            // Create the templates to get the source but don't instantiate a controller yet
            var requires = {};
            controllerPath.match(/(.*?)([0-9A-Za-z_]*)\.js$/)
            var prop = RegExp.$2

            // Create a new unique object template utility
            var objectTemplate = require("persistor")(ObjectTemplate, RemoteObjectTemplate, RemoteObjectTemplate);

            // Inject into it any db or persist attributes needed for application
            initObjectTemplate(objectTemplate);

            // Get the controller and all of it's dependent requires which will populate a
            // key value pairs where the key is the require prefix and and the value is the
            // key value pairs of each exported template

            var requires = getTemplates(objectTemplate, config.appPath, [prop + ".js"], config, path);

            return Q.fcall(function ()
            {
                return {
                    getServerConnectString: function () {
                        return JSON.stringify({
                            url: "/amorphic/xhr?path=" + path,
                            message: {ver: appVersion, startingSequence: 0, sessionExpiration: sessionExpiration}
                        })
                    },
                    getServerConfigString: function () {return getServerConfigString(config)},
                    getPersistorProps: function () {
                        return objectTemplate.getPersistorProps ? objectTemplate.getPersistorProps() : {};
                    }
                }
            });
        }
    }

    // Create or restore the controller
    var newSession = false;
    if (!session.semotus || !session.semotus.controllers[path] || reset || newControllerId)
    {
        newSession = newControllerId ? false : true;
        if (!session.semotus)
            session.semotus = {controllers: {}, loggingContext: {}};
        if (!session.semotus.loggingContext[path])
            session.semotus.loggingContext[path] = getLoggingContext(path);

        var time = process.hrtime();
        var controller = getController(path, controllerPath, initObjectTemplate, session, objectCacheExpiration, sessionStore, newPage, true, newControllerId, req);
        controller.__template__.objectTemplate.reqSession = req.session;
        if (amorphicOptions.performanceLogging){
            var diff = process.hrtime(time);
            var took = (diff[0] * 1e9 + diff[1]) / 1000000;
            console.log("performanceLogging: create controller took " + took + " ms");
        }

    } else {
        var controller = getController(path, controllerPath, initObjectTemplate, session, objectCacheExpiration, sessionStore, newPage, false, null, req);
        controller.__template__.objectTemplate.reqSession = req.session;
    }

    controller.__request = req;
    controller.__sessionExpiration = sessionExpiration;
    var objectTemplate = controller.__template__.objectTemplate;
    var ret =
    {
        objectTemplate: controller.__template__.objectTemplate,
        getMessage: function () {
            var message = objectTemplate.getMessage(session.id, true);
            message.newSession = true;
            message.rootId = controller.__id__;
            message.startingSequence = objectTemplate.maxClientSequence + 100000;
            message.sessionExpiration = sessionExpiration;
            return message;
        },
        getServerConnectString: function () {
            var message = this.getMessage();
            message.ver = appVersion;
            return JSON.stringify({
                url: "/amorphic/xhr?path=" + path,
                message: message
            })
        },
        getServerConfigString: function () {return getServerConfigString(config)},

        save: function (path, session) {
            saveSession(path, session, controller);
        },
        restoreSession: function () {
            return restoreSession(path, session, controller.__template__);
        },
        newSession: newSession,
        appVersion: appVersion,
        getPersistorProps: function () {
            return objectTemplate.getPersistorProps ? objectTemplate.getPersistorProps() : {};
        }

    };

    if (newPage)
        saveSession(path, session, controller);
    return Q.fcall(function () {return ret});
}
var controllers = {};

function getServerConfigString(config) {
    var browserConfig = {}
    var whitelist = (config.appConfig.toBrowser || {});
    whitelist.modules = true;
    whitelist.templateMode = true;
    for (var key in whitelist)
        browserConfig[key] = config.appConfig[key];
    return JSON.stringify(browserConfig);
}

function getTemplates(objectTemplate, appPath, templates, config, path, sourceOnly, detailedInfo) {

    var requires = {};
    var ref = {};
    var mixins = [];
    var all_require_results = {};
    var all_file_paths = {};
    var ignoringClient = false;
    var filesNeeded = {};
    objectTemplate.__statics__ = objectTemplate.__statics__ || {};
    var applicationSourceCandidate = {};
    var ast = null;
    objectTemplate.__initialized__ = false;

    var deferredExtends = [];
    function addTemplateToRequires (prop, template) {
        requires[prop] = requires[prop] || {}
        requires[prop][template.__name__] = template;
        console.log("Adding " + prop + ":" + template.__name__);
    }

    // An object for creating request to extend classes to be done at thend of V2 pass1
    function usesV2ReturnPass1 (base, prop) {
        this.baseName = base
        this.prop = prop;
    }
    usesV2ReturnPass1.prototype.mixin = function () {};
    usesV2ReturnPass1.prototype.extend = function(name) {
        this.extendedName = name;
        deferredExtends.push(this);
        return new usesV2ReturnPass1(name, this.prop);
    };
    usesV2ReturnPass1.prototype.doExtend = function() {
        if (!objectTemplate.__dictionary__[this.baseName])
            throw Error("Attempt to extend " + this.baseName + " which was never defined");
        var template = objectTemplate.__dictionary__[this.baseName].extend(this.extendedName, {});
        addTemplateToRequires(this.prop, template);
    };

    if (amorphicOptions.sourceMode == 'debug')
        applicationSource[path] = "";
    function getTemplate(file, options, uses) {
        var objectTemplateSubClass = objectTemplate._createObject();
        var previousIgnoringClient = ignoringClient;
        if(options && (options.client === false))
            ignoringClient = true;
        file.match(/([0-9A-Za-z_]*)\.js/);
        var prop = RegExp.$1;
        if (!ignoringClient) {
            filesNeeded[prop] = true;
        }
        if (requires[prop]) {
            ignoringClient = previousIgnoringClient;
            return requires[prop];
        }
        if (ref[prop])
            if (uses)
                return;
            else
                throw  new Error("circular reference on " + file);
        ref[prop] = true;

        // 1. If the file is to be 'required' from a specific app, use
        // that app, otherwise
        // 2. look for the file under the current app,
        // 3. otherwise look under common
        var clientPath, require_results;
        var requirePath;
        if(options && options.app){
            clientPath = options.app;
            var daemonPath =  config.commonPath + '/../../' + clientPath + '/js/' + file;
            var interactivePath = config.commonPath + '/../../' + clientPath + '/public/js/' + file;
            if (fs.existsSync(daemonPath)) {
                require_results = require(daemonPath);
                requirePath = daemonPath;
            } else {
                require_results = require(interactivePath);
                requirePath = interactivePath;
            }
        }
        else if (fs.existsSync(appPath + file)) {
            clientPath = path;
            require_results = require(appPath + file);
            requirePath = appPath + file;
        } else {
            clientPath = 'common';
            require_results = require(config.commonPath + file);
            requirePath = config.commonPath + file;
        }

        // There is a legacy mode where recursive templates are handled with a two-phase two-function call
        // in the templates which return an object with an xxx prop and an xxx_mixin prop named the same as the file
        // In the current mode (V2), a function is returned which is called in two passes.  On the first pass
        // an ObjectTemplate subclass is passed in that only creates templates but does not process their properties
        // and on a second pass converts all create calls to mixins and returns the actual templates when referenced
        // via the getTemplate second parameter
        var objectTemplateInitialize = require_results['objectTemplateInitialize'];
        var initializer = (require_results[prop]);
        var mixins_initializer = (require_results[prop + "_mixins"]);
        if (typeof(initializer) != "function")
            throw  new Error(prop + " not exported in " + appPath + file);

        if ( config.appConfig && config.appConfig.templateMode == "auto") {
            (function () {
                var closureProp = prop;
                objectTemplateSubClass.create = function (name) {
                    var template = objectTemplate.create(name, {});
                    var originalExtend = template.extend;
                    template.extend = function (name, props)  {
                        var template = objectTemplate.__dictionary__[name];
                        if (template)
                            template.mixin(props);
                        else {
                            template = originalExtend.call(this, name, props);
                            console.log("Extending " + this.__name__ + " to " + template.__name__);
                            addTemplateToRequires(closureProp, template);
                        }
                        return template;
                    }
                    addTemplateToRequires(closureProp, template);
                    return template;
                }
                var previousToClient = objectTemplate.__toClient__;
                objectTemplate.__toClient__ = !ignoringClient;

                var initializerReturnValues = require_results[prop](objectTemplateSubClass,
                    function usesV2Pass1 (file, templateName, options) {
                        var templateName = templateName || file.replace(/\.js$/,'').replace(/.*?[\/\\](\w)$/,'$1');
                        getTemplate(file, options, true);
                        return new usesV2ReturnPass1(templateName, closureProp);
                    }
                );
                console.log(prop);
                all_require_results[prop] = require_results[prop];
                objectTemplate.__toClient__ = previousToClient;
                for (var returnVariable in initializerReturnValues)
                    if (!objectTemplate.__dictionary__[returnVariable])
                        objectTemplate.__statics__[returnVariable] = initializerReturnValues[returnVariable];
            })()

        } else {

            // Call application code that can poke properties into objecTemplate
            if (!objectTemplate.__initialized__ && objectTemplateInitialize && !sourceOnly)
                objectTemplateInitialize(objectTemplate);
            objectTemplate.__initialized__ = true;

            // Call the initialize function in the template
            var previousToClient = objectTemplate.__toClient__;
            objectTemplate.__toClient__ = !ignoringClient;
            var templates = initializer(objectTemplate, getTemplate, usesV1);
            objectTemplate.__toClient__ = previousToClient;
            requires[prop] = templates;

            if (Object.getOwnPropertyNames(templates).length == 0) {
                objectTemplate.__statics__[prop] = templates;
            } else {
                for (var returnVariable in templates)
                    if (!objectTemplate.__dictionary__[returnVariable])
                        objectTemplate.__statics__[returnVariable] = templates[returnVariable];
            }


            if (mixins_initializer)
                mixins.push(mixins_initializer);

            all_require_results[prop] = initializer;
            if (mixins_initializer)
                all_require_results[prop + '_mixins'] = mixins_initializer;

        }
        all_file_paths[prop] = requirePath;

        if (typeof(path) != 'undefined') {
            if (amorphicOptions.sourceMode == 'debug') {
                applicationSourceCandidate[prop] = ["document.write(\"<script src='/" + clientPath + "/js/" + file + "?ver=" + config.appVersion + "'></script>\");\n\n"];
            } else {
                applicationSourceCandidate[prop] = ["module.exports." + prop + " = " + require_results[prop] + "\n\n" +
                (objectTemplateInitialize ? "module.exports.objectTemplateInitialize = " + objectTemplateInitialize + "\n\n" : "") +
                (mixins_initializer ? "module.exports." + prop + "_mixins = " + mixins_initializer + "\n\n" : ""),
                    "/" + clientPath + "/js/" + file + "?ver=" + config.appVersion];
            }
        }

        ignoringClient = previousIgnoringClient;
        return templates;

        function usesV1 (file, options) {
            getTemplate(file, options, true);
        }
    }

    // Process each template passed in (except for unit tests there generally is just the controller)
    for (var ix = 0; ix < templates.length; ++ix)
        getTemplate(templates[ix]);

    // Extended classes can't be processed until now when we know we have all the base classes defined
    for (var ix = 0; ix < deferredExtends.length; ++ix)
        deferredExtends[ix].doExtend();

    // Add the sources to either a structure to be uglified or to an object for including one at a time
    for (var prop in applicationSourceCandidate)
        if (filesNeeded[prop]) {
            if (amorphicOptions.sourceMode == 'debug')
                applicationSource[path] += applicationSourceCandidate[prop][0];
            else
                addUglifiedSource(applicationSourceCandidate[prop][0], applicationSourceCandidate[prop][1]);
        } else {
            for (var template in requires[prop])
                if (requires[prop][template])
                    requires[prop][template].__toClient__ = false;
                else
                    console.log(template + " not found in requires for " + prop);
        }

    // Process V1 style mixins
    for (var ix = 0;ix < mixins.length;++ix)
        if (mixins[ix])
            (mixins[ix])(objectTemplate, requires, flatten(requires));

    // Process V2 pass 2
    var objectTemplateSubClass = objectTemplate._createObject();
    if (config.appConfig && config.appConfig.templateMode == "auto")
        for (var prop in all_require_results) {
            objectTemplateSubClass.create = function (name, props) {
                objectTemplate.__dictionary__[name].mixin(props);
                return objectTemplate.__dictionary__[name];
            }
            all_require_results[prop](objectTemplateSubClass, usesV2Pass2);
            function usesV2Pass2 (file, templateName, options) {
                var templateName = templateName || file.replace(/\.js$/,'').replace(/.*?[\/\\](\w)$/,'$1');
                return objectTemplate.__dictionary__[templateName] || objectTemplate.__statics__[templateName];;
            }
        }
    // Handle NPM includes
    if (config && config.appConfig && config.appConfig.modules)
        for(var mixin in config.appConfig.modules)
            if (!config.appConfig.modules[mixin].require)
                console.log("Module " + mixin + " missing a requires property ");
            else if (typeof(require(config.appConfig.modules[mixin].require)[mixin + "_mixins"]) != "function")
                console.log(config.appConfig.modules[mixin].require + " must export a " + mixin +
                    "_mixins property which is an initialization function");
            else {
                var requireName = config.appConfig.modules[mixin].require;
                var results = require(requireName);
                results[mixin + "_mixins"](objectTemplate, requires, config.appConfig.modules[mixin], config.appConfig.nconf);
                if (typeof(path) != 'undefined')
                    if (amorphicOptions.sourceMode == 'debug') {
                        applicationSource[path] += "document.write(\"<script src='/modules/" + requireName + "/index.js?ver=" + config.appVersion + "'></script>\");\n\n";
                    } else {
                        addUglifiedSource("module.exports." + mixin + "_mixins = " + results[mixin + "_mixins"] + "\n\n", '/modules/' + requireName + '/index.js?ver=' + config.appVersion);
                    }
            }

    // Record source and source map
    if (ast && !applicationSource[path] && !config.appConfig.isDaemon) {
        ast.figure_out_scope();
        var compressor = UglifyJS.Compressor();
        ast = ast.transform(compressor);
        var walker = new UglifyJS.TreeTransformer(before);
        ast = ast.transform(walker);
        var source_map = UglifyJS.SourceMap();
        var stream = UglifyJS.OutputStream({source_map: source_map});
        ast.print(stream);
        applicationSource[path] = stream.toString();
        applicationSourceMap[path] = source_map.toString();
        function before (node,  descend) {

            if (node instanceof UglifyJS.AST_ObjectProperty && node.key == "body" && findOnServer(walker.parent())) {
                var emptyFunction = node.clone();
                emptyFunction.value.variables = {};
                emptyFunction.value.body = [];
                emptyFunction.value.argNames = []
                emptyFunction.value.start = UglifyJS.AST_Token({type: 'string', value: '{'})
                emptyFunction.value.end =   UglifyJS.AST_Token({type: 'string', value: '}'})
                return emptyFunction;
            }
            node = node.clone();
            descend(node, this);
            return node;
            function findOnServer(node) {
                var ret = null;
                if (node.properties)
                    node.properties.forEach(isOnServer);
                return ret;
                function isOnServer(node) {
                    if (node.key == "on" && node.value && node.value.value == "server")
                        ret = node;
                }
            }

        }
    }
    if (!sourceOnly)
        objectTemplate.performInjections();

    if (detailedInfo) {
        detailedInfo.moduleExports = requires;
        detailedInfo.initializers = all_require_results;
        detailedInfo.filePaths = all_file_paths;
    }

    return requires;

    function addUglifiedSource(data, file) {
        ast = applicationSource[path] ? ast : UglifyJS.parse(data, { filename: file, toplevel: ast });
    }
    function flatten (requires) {
        classes = {};
        for (var f in requires)
            for (var c in requires[f])
                classes[c] = requires[f][c];
        return classes;
    }
}
/**
 * Create a controller template that has a unique RemoteObjectTemplate instance that is
 * for one unique session
 *
 * @param path - unique path for application
 * @param controllerPath - file path for controller objects
 * @param initObjectTemplate - callback for dependency injection into controller
 * @param session - connect session object
 * @param objectCacheExpiration - seconds to expire controller object cache
 * @param sessionStore - session implementation
 * @param newPage - force returning everything since this is likely a session continuation on a new web page
 * @param reset - create new clean empty controller losing all data
 * @param req - connect request
 * @returns {*}
 */
function getController(path, controllerPath, initObjectTemplate, session, objectCacheExpiration, sessionStore, newPage, reset, controllerId,  req)
{
    var sessionId = session.id;
    var config = applicationConfig[path];


    // Manage the controller cache
    if (!controllers[sessionId + path])
        controllers[sessionId + path] = {};
    var cachedController = controllers[sessionId + path];

    // Clear controller from cache if need be
    if (reset || newPage)
    {
        if (cachedController.timeout)
            clearTimeout(cachedController.timeout);
        controllers[sessionId + path] = {};
        cachedController = controllers[sessionId + path];
        if (reset) // Hard reset makes sure we create a new controller
            session.semotus.controllers[path] = null;
    }

    // We cache the controller object which will reference the object template and expire it
    // as long as there are no pending calls.  Note that with a memory store session manager
    // the act of referencing the session will expire it if needed
    var timeoutAction = function ()
    {
        sessionStore.get(sessionId, function (error, session) {
            if (!session)
                log(1, sessionId, "Session has expired");
            if (!session || cachedController.controller.__template__.objectTemplate.getPendingCallCount() == 0) {
                controllers[sessionId + path] = null;
                log(1, sessionId, "Expiring controller cache for " + path);
            } else {
                cachedController.timeout = setTimeout(timeoutAction, objectCacheExpiration);
                log(2, sessionId, "Extending controller cache timeout because of pending calls for " + path);
            }
        });
    }

    // Return controller from the cache if possible regenerating timeout
    if (cachedController.controller) {
        clearTimeout(cachedController.timeout);
        cachedController.timeout = setTimeout(timeoutAction, objectCacheExpiration);
        log(2, sessionId, "Extending controller cache timeout because of reference ");
        return cachedController.controller;
    }

    var requires = {};
    controllerPath.match(/(.*?)([0-9A-Za-z_]*)\.js$/)
    var prefix = RegExp.$1;
    var prop = RegExp.$2

    // Create a new unique object template utility
    var objectTemplate = require("persistor")(ObjectTemplate, RemoteObjectTemplate, RemoteObjectTemplate);

    setupLogger(objectTemplate.logger, path, session.semotus.loggingContext[path]);

    // Inject into it any db or persist attributes needed for application
    initObjectTemplate(objectTemplate);

    // Restore any saved objectMap
    if (session.semotus.objectMap && session.semotus.objectMap[path]){
        //session.semotus.objectMap = decompressSessionData(session.semotus.objectMap);
        objectTemplate.objectMap = session.semotus.objectMap[path];
    }

    // Get the controller and all of it's dependent requires which will populate a
    // key value pairs where the key is the require prefix and and the value is the
    // key value pairs of each exported template
    var requires = getTemplates(objectTemplate, prefix, [prop + ".js"], config, path);
    var controllerTemplate = requires[prop].Controller;
    if (!controllerTemplate)
        throw  new Error("Missing controller template in " + prefix + prop + ".js");
    controllerTemplate.objectTemplate = objectTemplate;

    // Setup unique object template to manage a session

    objectTemplate.createSession("server", null, session.id);
    var browser = " - browser: " + req.headers['user-agent'] + " from: " + (req.headers['x-forwarded-for'] || req.connection.remoteAddress);

    // Either restore the controller from the serialized string in the session or create a new one

    var controller;

    if (!session.semotus.controllers[path]) {

        if (controllerId) {
            // Since we are restoring we don't changes saved or going back to the browser
            objectTemplate.withoutChangeTracking(function () {
                controller = objectTemplate._createEmptyObject(controllerTemplate, controllerId);
                objectTemplate.syncSession(); // Kill changes to browser
            });
        } else
            controller = new controllerTemplate();

        if (typeof(controller.serverInit) == "function")
            controller.serverInit();
        // With a brand new controller we don't want old object to persist id mappings
        if (objectTemplate.objectMap)
            objectTemplate.objectMap = {}
        objectTemplate.logger.info({component: 'amorphic', module: 'getController', activity: 'new', controllerId: controller.__id__, requestedControllerId: controllerId || 'none'},
            "Creating new controller " + (newPage ? " new page " : "") + browser);
    } else {
        objectTemplate.withoutChangeTracking(function () {
            controller = objectTemplate.fromJSON(decompressSessionData(session.semotus.controllers[path]), controllerTemplate);
            // Make sure no duplicate ids are issued
            var semotusSession = objectTemplate._getSession();
            for (var obj in semotusSession.objects)
                if (obj.match(/^server-[\w]*?-([0-9]+)/))
                    semotusSession.nextObjId = Math.max(semotusSession.nextObjId, RegExp.$1 + 1);
            objectTemplate.logger.info({component: 'amorphic', module: 'getController', activity: 'restore'},
                "Restoreing saved controller " + (newPage ? " new page " : "") + browser);
            if (!newPage) // No changes queued as a result unless we need it for init.js
                objectTemplate.syncSession();
        });
    }

    objectTemplate.controller = controller;
    controller.__sessionId = sessionId;

    // Set it up in the cache
    cachedController.controller = controller;
    cachedController.timeout = setTimeout(timeoutAction, objectCacheExpiration);

    return controller;
}

function getLoggingContext(app, context) {
    context = context || {}
    context.environment = process.env.NODE_ENV || 'local';
    context.name = app;
    context.hostname = hostName;
    context.pid = process.pid;
    return context;
}

function getModelSource  (path) {
    return applicationSource[path];
}

function getModelSourceMap (path) {
    return applicationSourceMap[path];
}

function compressSessionData(data) {
    if(amorphicOptions.compressSession) {
        return zlib.deflateSync(data);
    }
    return data;
}

function decompressSessionData(objData) {
    if(amorphicOptions.compressSession && objData.data) {
        var buffer = new Buffer(objData.data)
        return zlib.inflateSync(buffer);
    }
    return objData;
}

function saveSession(path, session, controller) {
    var request = controller.__request;
    controller.__request = null;
    var time = process.hrtime();

    var ourObjectTemplate = controller.__template__.objectTemplate;
    var serialSession = typeof(ourObjectTemplate.serializeAndGarbageCollect) == 'function' ?
        ourObjectTemplate.serializeAndGarbageCollect() : controller.toJSONString();
    session.semotus.controllers[path] = compressSessionData(serialSession);
    session.semotus.lastAccess = new Date(); // Tickle it to force out cookie

    if (ourObjectTemplate.objectMap) {
        if (!session.semotus.objectMap)
            session.semotus.objectMap = {}
        session.semotus.objectMap[path] = ourObjectTemplate.objectMap;
    }

    if (amorphicOptions.performanceLogging){
        var diff = process.hrtime(time);
        var took = (diff[0] * 1e9 + diff[1]) / 1000000;
        ourObjectTemplate.logger.info({component: 'amorphic', module: 'saveSession', activity: 'performanceLogging'},
            "performanceLogging: save session " + took + " ms - length = " + session.semotus.controllers[path].length);
    }

    controller.__request = request;
}

function restoreSession(path, session, controllerTemplate) {

    var objectTemplate = controllerTemplate.objectTemplate;

    var time = process.hrtime();
    // Get the cached controller
    if (!controllers[session.sessionId + path]){
        controllers[session.sessionId + path] = {};
    }
    var cachedController = controllers[session.sessionId + path];

    // restore the controller from the session

    var controller;
    objectTemplate.withoutChangeTracking(function () {
        controller = objectTemplate.fromJSON(decompressSessionData(session.semotus.controllers[path]), controllerTemplate);
        if (session.semotus.objectMap && session.semotus.objectMap[path])
            objectTemplate.objectMap = session.semotus.objectMap[path];
        objectTemplate.logger.info({component: 'amorphic', module: 'restoreSession', activity: 'restoring'});
        objectTemplate.syncSession();  // Clean tracking of changes
    });
    objectTemplate.controller = controller;
    controller.__sessionId = session.sessionId;

    // Set it up in the cache
    cachedController.controller = controller;

    if (amorphicOptions.performanceLogging){
        var diff = process.hrtime(time);
        var took = (diff[0] * 1e9 + diff[1]) / 1000000;
        objectTemplate.logger.info({component: 'amorphic', module: 'restoreSession', activity: 'performanceLogging'},
            "performanceLogging: restore session " + took + " ms - length = " + session.semotus.controllers[path].length);
    }

    return controller;
}

var downloads;
function setDownloadDir(dir) {
    downloads = dir;
}

function processFile(req, resp, next)
{
    if (!downloads) {
        console.log("no download directory");
        next();
        return;
    }

    var form = new formidable.IncomingForm();
    form.uploadDir = downloads;
    form.parse(req, function(err, fields, files) {
        if (err)
            console.log(err);
        resp.writeHead(200, {'content-type': 'text/html'});
        var file = files.file.path;
        console.log(file);
        setTimeout(function () {
            fs.unlink(file, function (err) {
                if (err)
                    console.log(err)
                else {
                    console.log(file + ' deleted');
                }
            })}, 60000);
        var fileName = files.file.name;
        req.session.file = file;
        resp.end('<html><body><script>parent.amorphic.prepareFileUpload(\'package\');parent.amorphic.uploadFunction.call(null, "' +  fileName + '"' + ')</script></body></html>');
    });
}

/**
 * Process a post request by establishing a session and calling the controllers processPost method
 * which can return a response to be sent back
 * @param req
 * @param resp
 */
function processPost(req, resp)
{
    var session = req.session;
    var message = req.body;
    var path = url.parse(req.url, true).query.path;

    establishServerSession(req, path, false, false, null).then (function (semotus)
    {
        var ourObjectTemplate = semotus.objectTemplate;
        var remoteSessionId = req.session.id;
        if (typeof(ourObjectTemplate.controller.processPost) == "function") {
            Q(ourObjectTemplate.controller.processPost(req.body)).then(function (controllerResp) {
                ourObjectTemplate.setSession(remoteSessionId);
                semotus.save(path, session);
                resp.writeHead(controllerResp.status, controllerResp.headers || {"Content-Type": "text/plain"});
                resp.end(controllerResp.body);
            }).catch(function (e) {
                ourObjectTemplate.logger.info({component: 'amorphic', module: 'processPost', activity: 'error'}, "Error " + e.message + e.stack);
                resp.writeHead(500, {"Content-Type": "text/plain"});
                resp.end("Internal Error");
            });
        } else
            throw "Not Accepting Posts";
    }).fail(function(error){
        console.log("Error establishing session for processPost ", req.sessionId, error.message + error.stack);
        resp.writeHead(500, {"Content-Type": "text/plain"});
        resp.end("Internal Error");
    }).done();
}

function processLoggingMessage(req, resp) {
    var path = url.parse(req.url, true).query.path;
    var session = req.session;
    var message = req.body;
    var objectTemplate = require("persistor")(ObjectTemplate, RemoteObjectTemplate, RemoteObjectTemplate);
    if (!session.semotus)
        session.semotus = {controllers: {}, loggingContext: {}};
    if (!session.semotus.loggingContext[path])
        session.semotus.loggingContext[path] = getLoggingContext(path);
    setupLogger(objectTemplate.logger, path, session.semotus.loggingContext[path]);
    objectTemplate.logger.setContextProps(message.loggingContext);
    objectTemplate.logger.setContextProps({session: req.session.id,
        ipaddress: ((req.headers['x-forwarded-for'] || req.connection.remoteAddress) + "")
            .split(',')[0].replace(/(.*)[:](.*)/,'$2') || "unknown"});
    message.loggingData.from = "browser";
    objectTemplate.logger[message.loggingLevel](message.loggingData);
    resp.writeHead(200, {"Content-Type": "text/plain"});
    resp.end("");
}

function setupLogger(logger, path, context) {
    logger.startContext(context);
    logger.setLevel(applicationConfig[path].logLevel);
    if (sendToLog)
        logger.sendToLog = sendToLog;
}

/**
 * Process JSON request message
 *
 * @param req
 * @param resp
 */

function processMessage(req, resp)
{
    var start = process.hrtime();
    var session = req.session;
    var message = req.body;
    var path = url.parse(req.url, true).query.path;
    if (!message.sequence) {
        log(1, req.session.id, "ignoring non-sequenced message");
        resp.writeHead(500, {"Content-Type": "text/plain"});
        resp.end("ignoring non-sequenced message");
        return;
    }
    var newPage = message.type == "refresh" ? true : false;
    var forceReset = message.type == "reset" ? true : false;

    establishServerSession(req, path, newPage, forceReset, message.rootId).then (function (semotus)
    {
        semotus.objectTemplate.logger.setContextProps(message.loggingContext);
        var context = semotus.objectTemplate.logger.setContextProps({sequence: message.sequence, session: req.session.id,
            ipaddress: ((req.headers['x-forwarded-for'] || req.connection.remoteAddress) + "")
                .split(',')[0].replace(/(.*)[:](.*)/,'$2') || "unknown"});

        if (amorphicOptions.performanceLogging){
            var diff = process.hrtime(start);
            var took = (diff[0] * 1e9 + diff[1]) / 1000000;

            semotus.objectTemplate.logger.info({component: 'amorphic', module: 'processsMessage', activity: 'performanceLogging'},
                "performanceLogging: establish session " + took + "ms");
        }

        var ourObjectTemplate = semotus.objectTemplate;
        var remoteSessionId = req.session.id;

        ourObjectTemplate.expireSession = function () {
            req.session.destroy();
            ourObjectTemplate.sessionExpired = true;
        }
        ourObjectTemplate.sessionExpired = false;

        // If we expired just return a message telling the client to reset itself
        if (semotus.newSession || newPage || forceReset)
        {
            ourObjectTemplate.logger.info({component: 'amorphic', module: 'processMessage', activity: 'reset'},
                remoteSessionId, "Force reset on " + message.type + " " + (semotus.newSession ? 'new session' : '') +
                " [" + message.sequence + "]");
            semotus.save(path, session);
            var outbound = semotus.getMessage();
            outbound.ver = semotus.appVersion;
            ourObjectTemplate.logger.clearContextProps(context);
            resp.end(JSON.stringify(outbound));  // return a sync message assuming no queued messages
            return;
        }

        // When RemoteObjectTemplate sends a message it will either be a response or
        // a callback to the client.  In either case return a response and prevent
        // any further messages from being generated as these will get handled on
        // the next call into the server
        var sendMessage = function (message)
        {
            ourObjectTemplate.setSession(remoteSessionId);
            ourObjectTemplate.enableSendMessage(false);
            semotus.save(path, session);
            message.ver = semotus.appVersion;
            message.sessionExpired = ourObjectTemplate.sessionExpired;
            var respstr = JSON.stringify(message)
            ourObjectTemplate.logger.clearContextProps(context);
            resp.end(respstr);
            if (amorphicOptions.performanceLogging){
                var diff = process.hrtime(start);
                var took = (diff[0] * 1e9 + diff[1]) / 1000000;
                ourObjectTemplate.logger.info({component: 'amorphic', module: 'processMessage', activity: 'performanceLogging'},
                    "performanceLogging: processing request took " + took + " response length = " + respstr.length);
            }
        }

        ourObjectTemplate.incomingIP = ((req.headers['x-forwarded-for'] || req.connection.remoteAddress) + "")
                .split(',')[0].replace(/(.*)[:](.*)/,'$2') || "unknown";

        ourObjectTemplate.enableSendMessage(true, sendMessage);  // Enable the sending of the message in the response
        try {
            ourObjectTemplate.processMessage(message, null, semotus.restoreSession);
        } catch (error) {
            ourObjectTemplate.logger.info({component: 'amorphic', module: 'processMessage', activity: 'error'},
                error.message + error.stack);
            resp.writeHead(500, {"Content-Type": "text/plain"});
            ourObjectTemplate.logger.clearContextProps(context);
            resp.end(error.toString());
        }
    }).fail(function(error){
        log(0, req.sessionId, error.message + error.stack);
        resp.writeHead(500, {"Content-Type": "text/plain"});
        resp.end(error.toString());
    }).done();
}
function route(req, resp, next) {
    if (req.url.match(/amorphic\/xhr\?path\=/))
        req.body.type == 'logging' ? processLoggingMessage(req, resp) : processMessage(req, resp);
    else
        next();
}
function uploadRoute(req, resp, next) {
    if (req.url.match(/amorphic\/xhr\?path\=/) && url.parse(req.url, true).query.file && req.method=='POST')
        processFile(req, resp,next)
    else
        next();
}
function postRoute(req, resp, next) {
    if (req.url.match(/amorphic\/xhr\?path\=/) && url.parse(req.url, true).query.form && req.method=='POST')
        processPost(req, resp,next)
    else
        next();
}function downloadRoute(req, resp, next) {
    var file = url.parse(req.url, true).query.file;
    if (req.url.match(/amorphic\/xhr\?path\=/) && file && req.method=='GET')
        processContentRequest(req, resp, next, file)
    else
        next();
}

function processContentRequest(request, response, next) {

    var path = url.parse(request.url, true).query.path;
    establishServerSession(request, path, false).then (function (semotus) {
        if (typeof(semotus.objectTemplate.controller.onContentRequest) == 'function')
            semotus.objectTemplate.controller.onContentRequest(request, response);
    });
}

// Logging for rare situations where we don't have an objectTemplate
function log (level, sessionId, data) {
    if (level > logLevel)
        return;
    var t = new Date();
    var time = t.getFullYear() + "-" + (t.getMonth() + 1) + "-" + t.getDate() + " " +
        t.toTimeString().replace(/ .*/, '') + ":" + t.getMilliseconds();
    var message = (time + "(" + sessionId +") " + "Semotus:" + data);
    console.log(message);
    if (level == 0 && logger)
        setTimeout(function () {logger.call(null, message)}, 0);

}

function listen(dirname, sessionStore, preSessionInject, postSessionInject, sendToLogFunction)
{
    var fs = require('fs');
    var Q = require('q');
    var url = require('url');
    var connect = require('connect');
    var http = require('http');
    var https = require('https');
    var amorphic = require('amorphic');
    var path = require('path');

    var configBuilder = require('./configBuilder').ConfigBuilder;
    var configApi = require('./configBuilder').ConfigAPI;
    sendToLog = sendToLogFunction;


    // Create temporary directory for file uploads
    var downloads = path.join(path.dirname(require.main.filename), 'download');
    if (!fs.existsSync(downloads))
        fs.mkdirSync(downloads);
    var files = fs.readdirSync(downloads);
    for (var ix = 0; ix < files.length; ++ix)
        fs.unlinkSync(path.join(downloads, files[ix]));
    amorphic.setDownloadDir(downloads);

    var builder = new configBuilder(new configApi());
    var configStore = builder.build(dirname);

    // Configuraiton file
    var rootCfg = configStore['root'];
    // Global varibles
    var sessionExpiration = rootCfg.get('sessionSeconds') * 1000;
    var objectCacheExpiration = rootCfg.get('objectCacheSeconds') * 1000;

    amorphicOptions.compressXHR = rootCfg.get('compressXHR') || amorphicOptions.compressXHR;
    amorphicOptions.sourceMode = rootCfg.get('sourceMode') || amorphicOptions.sourceMode;
    amorphicOptions.compressSession = rootCfg.get('compressSession') || amorphicOptions.compressSession;
    amorphicOptions.performanceLogging = rootCfg.get('performanceLogging') || amorphicOptions.performanceLogging;
    console.log('Starting Amorphic with options: ' + JSON.stringify(amorphicOptions));
    if(amorphicOptions.compressSession){
        console.log('Compress Session data requires node 0.11 or greater, current version is: ' + process.version);
    }

    sessionStore = sessionStore || new (connect.session.MemoryStore)();
    var sessionRouter = connect.session(
        {store: sessionStore, secret: rootCfg.get('sessionSecret'),
            cookie: {maxAge: sessionExpiration}, rolling: true}
    );

    // Initialize applications

    var appList = rootCfg.get('applications');
    var appStartList = rootCfg.get('application') + ';';
    var mainApp = rootCfg.get('application').split(';')[0];
    var promises = [];
    var isNonBatch = false;
    var schemas = {};
    var app;
    for (var appKey in appList)
    {
        if (appStartList.match(appKey + ';'))
            (function () {
                var appName = appKey;
                var path = dirname + '/' + appList[appName] + '/';
                var cpath = dirname + '/apps/common/';
                function readFile (file) {return file && fs.existsSync(file) ? fs.readFileSync(file) : null;}

                var config = configStore[appKey].get();
                config.nconf = configStore[appKey]; // global config
                config.configStore = configStore;

                var schema = JSON.parse((readFile(path + "/schema.json") || readFile(cpath + "/schema.json")).toString());

                var dbConfig = (function(config){
                    return {
                        dbName : config.get(appName + '_dbName') || config.get('dbName') || config.get('dbname'),
                        dbPath : config.get(appName + '_dbPath') || config.get('dbPath') || config.get('dbpath'),
                        dbDriver : config.get(appName + '_dbDriver') || config.get('dbDriver') || config.get('dbdriver') || 'mongo',
                        dbType : config.get(appName + '_dbType') || config.get('dbType') || config.get('dbtype') || 'mongo',
                        dbUser : config.get(appName + '_dbUser') || config.get('dbUser') || config.get('dbuser') || 'nodejs',
                        dbPassword : config.get(appName + '_dbPassword') || config.get('dbPassword') || config.get('dbpassword') || null,
                        isDBSet : function () { return this.dbName && this.dbPath; },
                        connectMongo : function () { return this.dbPath + this.dbName },
                        dbConnections : config.get(appName + '_dbConnections') || config.get('dbconnections') || 20,
                        dbConcurrency : config.get(appName + '_dbConcurrency') || config.get('dbconcurrency') || 5
                    };
                })(config.nconf);

                if (dbConfig.isDBSet()) {
                    if (dbConfig.dbDriver == 'mongo') {
                        var MongoClient = require('mongodb-bluebird');
                        var dbClient = MongoClient.connect(dbConfig.connectMongo());
                    } else if (dbConfig.dbDriver == 'knex') {
                        var knex = require('knex')({
                            client: dbConfig.dbType,
                            connection: {
                                host     : dbConfig.dbPath,
                                database : dbConfig.dbName,
                                user: dbConfig.dbUser,
                                password: dbConfig.dbPassword,
                            }, pool: {min: 0, max: dbConfig.dbConnections}});
                        var dbClient = Q(knex);
                        (function () {
                            var closureKnex = knex;
                            deathWatch.push(function () {
                                console.log("closing knex connection");
                                return closureKnex.destroy();
                            });
                        })()
                    }
                    promises.push(dbClient
                        .then (function (db) {
                                console.log("DB connection established to " + dbConfig.dbName);
                                function injectObjectTemplate (objectTemplate) {
                                    if (dbConfig.dbDriver == "knex")
                                        objectTemplate.setDB(db, PersistObjectTemplate.DB_Knex);
                                    else
                                        objectTemplate.setDB(db);
                                    objectTemplate.setSchema(schema);
                                    objectTemplate.config = config;
                                    objectTemplate.logLevel = config.nconf.get('logLevel') || 1;
                                    objectTemplate.concurrency = dbConfig.dbConcurrency;
                                }

                                amorphic.establishApplication(appName, path + (config.isDaemon ? '/js/' :'/public/js/'),
                                    cpath + '/js/', injectObjectTemplate,
                                    sessionExpiration, objectCacheExpiration, sessionStore, null, config.ver, config,
                                    config.nconf.get(appName + '_logLevel') || config.nconf.get('logLevel') || 'info');

                                if (config.isDaemon) {
                                    amorphic.establishDaemon(appName);
                                    console.log(appName + " started as a daemon");
                                } else
                                    promises.push(Q(true));

                            },
                            function(e) {
                                console.log(e.message)}).fail(function (e) {console.log(e.message + e.stack)
                        })
                    )} else {

                    // No database case

                    function injectObjectTemplate(objectTemplate) {
                        objectTemplate.config = config;
                        objectTemplate.logLevel = config.nconf.get('logLevel') || 1;
                    }

                    amorphic.establishApplication(appName, path + (config.isDaemon ? '/js/' :'/public/js/'),
                        cpath + '/js/', injectObjectTemplate,
                        sessionExpiration, objectCacheExpiration, sessionStore, null, config.ver, config,
                        config.nconf.get(appName + '_logLevel') || config.nconf.get('logLevel') || 'info');

                    if (config.isDaemon) {
                        amorphic.establishDaemon(appName);
                        console.log(appName + " started as a daemon");
                    } else
                        promises.push(Q(true));


                }
            })();
    }

    Q.all(promises).then( function ()
    {
        var app = connect();

        if (amorphicOptions.compressXHR)
            app.use(require('compression')());

        if (preSessionInject)
            preSessionInject.call(null, app);

        for (var appName in appList) {
            if (appStartList.match(appName + ';')) {
                var path = dirname + "/" + appList[appName] + "/public";
                app.use("/" + appName + '/', connect.static(path, {index: "index.html"}));
                if (appName == mainApp)
                    app.use("/", connect.static(path, {index: "index.html"}));
                console.log(appName + " connected to " + path);
            }
        }

        rootSuperType = fs.existsSync(dirname + "/node_modules/supertype") ? dirname : __dirname;
        rootSemotus = fs.existsSync(dirname + "/node_modules/semotus") ? dirname : __dirname;
        rootBindster = fs.existsSync(dirname + "/node_modules/amorphic-bindster") ? dirname : __dirname;

        app
            .use('/modules/', connect.static(dirname + "/node_modules"))
            .use('/bindster/', connect.static(rootBindster + "/node_modules/amorphic-bindster"))
            .use('/amorphic/', connect.static(__dirname))
            .use('/common/', connect.static(dirname + "/apps/common"))
            .use('/supertype/', connect.static(rootSuperType + "/node_modules/supertype"))
            .use('/semotus/', connect.static(rootSemotus + "/node_modules/semotus"))
            .use(connect.cookieParser())
            .use(sessionRouter)
            .use(amorphic.uploadRouter)
            .use(amorphic.downloadRouter)
            .use(connect.bodyParser())
            .use(amorphic.postRouter)
            .use('/amorphic/init/' , function (request, response) {
                console.log ("Requesting " + request.originalUrl);
                if(request.originalUrl.match(/([A-Za-z0-9_]*)\.cached.js.map/)) {
                    var appName = RegExp.$1;
                    response.setHeader("Content-Type", "application/javascript");
                    response.setHeader("Cache-Control", "public, max-age=31556926");
                    response.end(amorphic.getModelSourceMap(appName));
                } else if(request.originalUrl.match(/([A-Za-z0-9_]*)\.cached.js/)) {
                    var appName = RegExp.$1;
                    response.setHeader("Content-Type", "application/javascript");
                    response.setHeader("Cache-Control", "public, max-age=31556926");
                    if (amorphicOptions.sourceMode == 'prod')
                        response.setHeader("X-SourceMap", "/amorphic/init/" + appName + ".cached.js.map?ver=" +
                            (request.originalUrl.match(/(\?ver=[0-9]+)/) ? RegExp.$1 : ""));
                    response.end(amorphic.getModelSource(appName));
                } else if(request.originalUrl.match(/([A-Za-z0-9_]*)\.js/)) {
                    var url = request.originalUrl;
                    var appName = RegExp.$1;
                    console.log("Establishing " + appName);
                    amorphic.establishServerSession(request, appName, "initial")
                        .then (function (session) {
                            if (request.method == 'POST' && session.objectTemplate.controller.processPost) {
                                Q(session.objectTemplate.controller.processPost(request.originalUrl, request.body, request)).then( function (controllerResp) {
                                    session.save(appName, request.session);
                                    response.writeHead(controllerResp.status, controllerResp.headers || {"Content-Type": "text/plain"});
                                    response.end(controllerResp.body || "");
                                });
                            } else {
                                response.setHeader("Content-Type", "application/javascript");
                                response.setHeader("Cache-Control", "public, max-age=0");
                                response.end(
                                    (amorphicOptions.sourceMode != 'debug'
                                        ? "document.write(\"<script src='" + url.replace(/\.js/, '.cached.js') + "'></script>\");\n"
                                        : amorphic.getModelSource(appName)) +
                                    "amorphic.setApplication('" + appName + "');" +
                                    "amorphic.setSchema(" + JSON.stringify(session.getPersistorProps()) + ");" +
                                    "amorphic.setConfig(" + JSON.stringify(JSON.parse(session.getServerConfigString())) +");" +
                                    "amorphic.setInitialMessage(" + session.getServerConnectString() +");"
                                );
                            }
                        }).done();
                }
            })

        if (postSessionInject)
            postSessionInject.call(null, app);

        app.use(amorphic.router);

        app.listen(rootCfg.get('port'));
    }).fail(function(e){console.log(e.message + " " + e.stack)});
}
module.exports = {
    establishApplication: establishApplication,
    establishDaemon: establishDaemon,
    establishServerSession: establishServerSession,
    saveSession: saveSession,
    processMessage: processMessage,
    router: route,
    uploadRouter: uploadRoute,
    postRouter: postRoute,
    downloadRouter: downloadRoute,
    getTemplates: getTemplates,
    setDownloadDir: setDownloadDir,
    listen: listen,
    getModelSource: getModelSource,
    getModelSourceMap: getModelSourceMap
}