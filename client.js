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
Persistor = ObjectTemplate.create("Peristor",
    {
    });


RemoteObjectTemplate._injectIntoTemplate = function (template)
{
    // Add persistors to foreign key references
    var schema = amorphic.schema[template.__name__] || {}
    var props = template.getProperties();
    for (var prop in props) {

        var defineProperty = props[prop];

        if (defineProperty.autoFetch || schema[prop]) {
            (function ()
            {
                var closureProp = prop;
                var closureDefineProperty = defineProperty;

                if (!props[closureProp + 'Persistor'])
                    template.createProperty(closureProp + 'Persistor', {type: Object, toServer: false,
                        value:{isFetched: defineProperty.autoFetch ? false : true, isFetching: false}});

                if (!template.prototype[closureProp + 'Fetch'])
                    template.createProperty(closureProp + 'Fetch', {on: "server", body: function (){}});

                if (!template.prototype[closureProp + 'Get'])
                    template.createProperty(closureProp + 'Get', {on: "client", body: function ()
                    {
                        var persistor = this[closureProp + 'Persistor'];
                        if ((persistor.isFetched == false) && !persistor.isFetching)
                        {
                            persistor.isFetching = true;
                            if (closureDefineProperty.type == Array)
                                this[closureProp] = [];
                            this[closureProp + "Fetch"].call(this);
                        }
                        return this[closureProp];
                    }});
            })();
        }
    }
}
var module = {exports: {}}

amorphic = // Needs to be global to make mocha tests work
{
    initializationData: {},
    lastServerInteraction: (new Date()).getTime(),
    setInitialMessage: function (message) {
        this.initializationData = message;
    },
    setConfig: function (config) {
        this.config = config;
        RemoteObjectTemplate.config = {nconf: {get: get}};
        function get (key) {
            return config[key];
        }
    },
    setSchema: function (schema) {
        this.schema = schema;
    },
    setApplication: function(app) {
        this.app = app;
    },
    maxAlerts: 5,
    shutdown: false,
    sequence: 1,
    logLevel: 1,
    rootId: null,
    config: {},
    schema: {},
    sessionExpiration: 0,
    sessionExpirationCushion: 10000,
    heartBeat: null,
    session: (new Date()).getTime(),
    state: 'live',
    app: 'generic',
    sessionId: 0,
    loggingContext: {},
    /**
     * start a session with the server and process any initial messages
     *
     * @param url - of the semotus message handler (usually /semotus)
     * @param rootCallback - callback that will passed the root object
     * @param renderCallback - callback to render UI changes upon receipt of message
     *
     */
    establishClientSession: function(controllerTemplate, appVersion, bindController, refresh, reload, offline)
    {
        this.setCookie('session' + this.app, this.session, 0);

        // Initialize object
        if (appVersion == "0")
            appVersion = null;
        this.url = this.initializationData.url;
        this.sessionExpiration = this.initializationData.message.sessionExpiration;
        this.bindController = bindController;
        this.appVersion = appVersion;
        this.reload = reload;
        this.offline = offline;
        this.refresh = refresh;

        this.importTemplates();

        // Grab the controller template which is not visible until after importTemplates
        this.controllerTemplate = window[controllerTemplate];
        if (!this.controllerTemplate) {
            alert("Can't find " + controllerTemplate);
            return;
        }
        this.sendLoggingMessage = function (level, data) {
            var message = {type: 'logging', loggingLevel: level, loggingContext: this.loggingContext, loggingData: data};
            this.loggingContext = {};
            this._post(self.url, message);
        }

        RemoteObjectTemplate.logger.sendToLog = function (level, data) {
            var output = RemoteObjectTemplate.logger.prettyPrint(level, data);
            console.log(output);
            if (level == 'error' || level == 'fatal') {
                this.sendLoggingMessage(level, data);
                if (this.controller && typeof(this.controller.displayError) == "function")
                    this.controller.displayError(output);
            }
        }.bind(this)

        this.setContextProps = RemoteObjectTemplate.logger.setContextProps;
        RemoteObjectTemplate.logger.setContextProps = function (props) {
            for (var prop in props)
                this.loggingContext[prop] = props[prop];
            this.setContextProps.call(RemoteObjectTemplate.logger, props);
        }.bind(this)

        /**
         * Send message to server and process response
         *
         * @param message
         */
        var self = this;
        this.sendMessage = function (message)
        {
            message.sequence = self.sequence++;
            message.loggingContext = self.loggingContext;
            self.loggingContext = {};

            // Sending rootId will reset the server
            if (self.rootId) {
                message.rootId = self.rootId;
                self.rootId = null;
                console.log("Forcing new controller on server");
            }
            if (self.logLevel > 0)
                console.log ("sending " + message.type + " " + message.name);
            self.lastServerInteraction = (new Date()).getTime();

            // Post xhr to server
            RemoteObjectTemplate.enableSendMessage(false);  // Queue stuff while we are out to the server
            self._post(self.url, message, function (request) // Success
            {
                RemoteObjectTemplate.enableSendMessage(true, this.sendMessage); // Re-enable sending

                var message = JSON.parse(request.responseText);
                if (self.logLevel > 0)
                    console.log("receiving " + message.type + " " + message.name + " serverAppVersion=" + message.ver +
                        "executionTime=" + ((new Date()).getTime() - self.lastServerInteraction) +
                        "ms messageSize=" + Math.round(request.responseText.length / 1000) + "K");

                // If app version in message not uptodate
                if (self.appVersion && message.ver != self.appVersion) {
                    console.log("Application version " + self.appVersion + " out of date - " +
                        message.ver + " is available - reloading in 5 seconds");
                    self.shutdown = true;
                    self.reload();
                    return;
                }

                // Setup a new session timeout check
                self._setSessionTimeout();
                if (message.type == "pinged")
                    return;

                if (message.sessionExpired)
                    RemoteObjectTemplate.clearPendingCalls();

                // Handle resets and refreshes
                if (message.newSession || message.type == "refresh")
                    self._reset(message);
                else {
                    var hasChanges = RemoteObjectTemplate.processMessage(message);
                    Q.delay(50).then(function () {self.refresh(hasChanges)}); // Let the promises settle out
                }

                if (message.sync === false)
                    self.refreshSession();

            }, function (err) { // Failure of the wire
                RemoteObjectTemplate.enableSendMessage(true, this.sendMessage); // Re-enable sending
                if (typeof(self.offline) == 'function')
                    self.offline.call();
                else if (--self.maxAlerts > 0)
                    alert("Error on server: " + err);
            });
        };

        // Kick everything off by processing initial message
        this._reset(this.initializationData.message, appVersion, reload);

        // Manage events for session expiration
        this.addEvent(document.body, 'click', function() {self._windowActivity();self.activity = true});
        this.addEvent(document.body, 'mousemove', function() {self._windowActivity();self.activity = true});
        this.addEvent(window, 'focus', function () {self._windowActivity()});
        setInterval(function () {self._zombieCheck()}, 50);

        // For file uploads we use an iFrame


    },

    prepareFileUpload: function(id)
    {
        var iFrame = document.getElementById(id);
        var iFrameDoc = iFrame.contentWindow.document;
        var content = document.getElementById(id + '_content').value;
        iFrameDoc.open();
        iFrameDoc.write(content.replace(/__url__/, this.url + '&file=yes'));
        iFrameDoc.close();
    },

    // When a zombie gets focus it wakes up.  Pushing it's cookie makes other live windows into zombies
    _windowActivity: function () {
        if (this.state == 'zombie') {
            this.expireController();  // Toss anything that might have happened
            RemoteObjectTemplate.enableSendMessage(true, this.sendMessage); // Re-enable sending
            this.state = 'live';
            this.rootId = null;  // Cancel forcing our controller on server
            this.refreshSession();
            console.log("Getting live again - fetching state from server");
        }
        this.setCookie('session' + this.app, this.session, 0);
    },

    // Anytime we see some other windows session has been stored we become a zombie
    _zombieCheck: function () {
        if (RemoteObjectTemplate.getPendingCallCount() == 0 &&
            this.getCookie('session' + this.app) != this.session) {
            if (this.state != 'zombie') {
                this.state = 'zombie'
                this.expireController();
                RemoteObjectTemplate.enableSendMessage(false);  // Queue stuff as a zombie we will toss it later
                console.log("Another browser took over, entering zombie state");
            }
        }
    },

    /**
     * Manage session expiration by listening for 'activity' and pinging the
     * the server just before the session expires
     */
    _setSessionTimeout: function () {
        var self = this;
        self.activity = false;
        if (self.heartBeat)
            clearTimeout(self.heartBeat);
        self.heartBeat = setTimeout(function ()
        {
            if (self.state == 'live') {
                if (self.activity) {
                    console.log("Server session ready to expire, activity detected, keeping alive");
                    self.pingSession(); // Will setup new timer
                } else
                // See if expiration handled by controller
                if (self.controller.clientExpire && this.controller.clientExpire()) {
                    console.log("Server session ready to expire, controller resetting itself to be offline");
                    return; // No new timer
                } else {
                    console.log("Server session ready to expire, resetting controller to be offline");
                    self.expireController();
                }
            }
        }, self.sessionExpiration - self.sessionExpirationCushion);
    },

    expireController: function ()
    {
        // Create new controller
        if (this.sessionId)
            RemoteObjectTemplate.deleteSession(this.sessionId)
        this.sessionId = RemoteObjectTemplate.createSession('client', this.sendMessage);
        this.controller = new (this.controllerTemplate)();
        this.rootId = this.controller.__id__;  // Force it to be sent as reset on next message
        RemoteObjectTemplate.controller = this.controller;
        RemoteObjectTemplate.syncSession(); // Start tracking changes post init
        this.bindController.call(null, this.controller, this.sessionExpiration); // rebind to app
    },

    pingSession: function () {
        this.sendMessage({type: 'ping'});
    },

    resetSession: function () {
        this.sendMessage({type: 'reset'});
    },

    refreshSession: function () {
        this.sendMessage({type: 'refresh'});
    },

    setNewController: function (controller, expiration) {
        this.rootId = controller.__id__;
        this.bindController.call(null, controller, expiration);
    },

    _reset: function (message, appVersion, reload)
    {
        if (this.sessionId)
            RemoteObjectTemplate.deleteSession(this.sessionId)
        this.sessionId = RemoteObjectTemplate.createSession('client', this.sendMessage);
        RemoteObjectTemplate.setMinimumSequence(message.startingSequence);
        if (message.rootId)
            this.controller = RemoteObjectTemplate._createEmptyObject(this.controllerTemplate, message.rootId)
        else {
            this.controller = new (this.controllerTemplate)();
            this.rootId = this.controller.__id__;
        }
        RemoteObjectTemplate.controller = this.controller;
        if (appVersion && message.ver != appVersion) {
            console.log("Application version " + appVersion + " out of date - " +
                message.ver + " is available - reloading in 5 seconds");
            this.shutdown = true;
            this.bindController.call(null, this.controller, message.sessionExpiration);
            reload();
            return;
        }
        RemoteObjectTemplate.syncSession();
        RemoteObjectTemplate.processMessage(message);
        this.bindController.call(null, this.controller, message.sessionExpiration);
    },
    _post: function (url, message, success, failure, retries, retryInterval) {
        success = success || function () {};
        failure = failure || function () {};
        retries = retries || 30;
        retryInterval = retryInterval || 2000;
        if (this.shutdown)
            return;
        var request = this.getxhr();
        request.open('POST', url, true);
        request.setRequestHeader("Content-Type", "application/json");
        var self = this;
        request.onreadystatechange = function () {
            if (request.readyState != 4)
                return;

            try {
                var status = request.status;
                var statusText = request.statusText;
            } catch (e) {
                var status = 666;
                var statusText = 'unknown';
            }
            if (status == 200 || status == 0) {
                if (this.logLevel > 0)
                    console.log("Got response for: " + message.type + " " + message.name);
                success.call(this, request)
            } else {
                console.log("Error: " + message.type + " " + message.name + " status: " + status + " - " + statusText);
                if (status == 503 && --retries) {
                    console.log("temporary error retrying in " + retryInterval / 1000 + " seconds");
                    setTimeout( function () {
                        return self._post(url, message, success, failure, retries, retryInterval);
                    }, retryInterval);
                } else
                    failure.call(this, status + " - " + statusText);
            }
        }
        try {
            request.send(JSON.stringify(message));
        } catch (e) {
            throw "xhr error " + e.message + " on " + url;
        }
    },
    getxhr: function() {
        try {
            return new XMLHttpRequest();
        } catch (e) {
            try {
                return new ActiveXObject("Msxml2.XMLHTTP");
            } catch (e2) {
                try {
                    return new ActiveXObject("Microsoft.XMLHTTP");
                } catch (e3) {
                    throw 'No support for XMLHTTP';
                }
            }
        }
    },
    /**
     * Import templates by calling each property of exports, dividing them into two rounds
     * and starting with the non _mixin
     */
    importTemplates: function () {

        if (module.exports.objectTemplateInitialize)
            module.exports.objectTemplateInitialize(RemoteObjectTemplate);

        var objectTemplateSubClass = Object.create(RemoteObjectTemplate);

        if (this.config.templateMode == "auto") {

            var deferredExtends = [];
            RemoteObjectTemplate.__statics__ = {};

            usesV2ReturnPass1.prototype.mixin = function () {};
            usesV2ReturnPass1.prototype.extend = function(name) {
                this.extendedName = name;
                deferredExtends.push(this);
                return new usesV2ReturnPass1(name);
            };
            usesV2ReturnPass1.prototype.doExtend = function(futureTemplates) {
                if (!RemoteObjectTemplate.__dictionary__[this.baseName]) {
                    if (futureTemplates[this.baseName])
                        futureTemplates[this.baseName].doExtend(futureTemplates);
                    if (!RemoteObjectTemplate.__dictionary__[this.baseName])
                        throw Error("Attempt to extend " + this.baseName + " which was never defined; extendedName=" + this.extendedName);
                }
                if (!RemoteObjectTemplate.__dictionary__[this.extendedName]) {
                    var template = RemoteObjectTemplate.__dictionary__[this.baseName].extend(this.extendedName, {});
                }
            };

            for (var exp in module.exports || {}) {
                if (!exp.match(/_mixins/)) {
                    objectTemplateSubClass.create = function (name) {
                        var template = RemoteObjectTemplate.create(name, {});
                        var originalExtend = template.extend;
                        template.extend = function (name, props)  {
                            var template = RemoteObjectTemplate.__dictionary__[name];
                            if (template)
                                template.mixin(props);
                            else
                                template = originalExtend.call(this, name, props);
                            return template;
                        }
                        return template;
                    }
                    var initializerReturnValues = (module.exports[exp])(objectTemplateSubClass, usesV2Pass1);
                    for (var returnVariable in initializerReturnValues)
                        if (!RemoteObjectTemplate.__dictionary__[returnVariable])
                            RemoteObjectTemplate.__statics__[returnVariable] = initializerReturnValues[returnVariable];
                }
            }

            // Extended classes can't be processed until now when we know we have all the base classes defined
            var futureTemplates = {}
            for (var ix = 0; ix < deferredExtends.length; ++ix)
                futureTemplates[deferredExtends[ix].extendedName] = deferredExtends[ix]
            for (var ix = 0; ix < deferredExtends.length; ++ix)
                deferredExtends[ix].doExtend(futureTemplates);


            var objectTemplateSubClass = Object.create(RemoteObjectTemplate);
            for (var exp in module.exports) {
                console.log("Pass 2 = processing" + exp);
                objectTemplateSubClass.create = function (name, props) {
                    if (RemoteObjectTemplate.__dictionary__[name.name || name])
                        RemoteObjectTemplate.__dictionary__[name.name || name].mixin(props);
                    else
                        RemoteObjectTemplate.create(name, props);
                    return RemoteObjectTemplate.__dictionary__[name.name || name];
                };
                (module.exports[exp])(objectTemplateSubClass, usesV2Pass2, this.config ? this.config.modules[exp.replace(/_mixins/,'')] : null);
              }
            for (var name in RemoteObjectTemplate.__dictionary__)
                window[name] = RemoteObjectTemplate.__dictionary__[name];
        } else {
            var requires = {}
            for (var exp in module.exports || {}) {
                if (!exp.match(/_mixins/)) {
                    var templates = (module.exports[exp])(RemoteObjectTemplate, function () {return window});
                    requires[exp] = templates;
                    for (var template in  templates)
                        window[template] = templates[template];
                }
            }
            var templates = flatten(requires);
            for (var exp in module.exports) {
                if (exp.match(/_mixins/)) {
                    var templates = (module.exports[exp])(RemoteObjectTemplate, requires,
                        this.config ? this.config.modules[exp.replace(/_mixins/,'')] : null,templates);
                    for (var template in  templates)
                        window[template] = templates[template];
                }
            }
            RemoteObjectTemplate.performInjections();
        }
        function usesV2Pass1 (file, templateName, options) {
            var templateName = templateName || file.replace(/\.js$/,'').replace(/.*?[\/\\](\w)$/,'$1');
            return new usesV2ReturnPass1(templateName);
        }
        // An object for creating request to extend classes to be done at thend of V2 pass1
        function usesV2ReturnPass1 (base) {
            this.baseName = base
        }
        function usesV2Pass2 (file, templateName, options) {
            var templateName = templateName || file.replace(/\.js$/,'').replace(/.*?[\/\\](\w)$/,'$1');
            return RemoteObjectTemplate.__dictionary__[templateName] || RemoteObjectTemplate.__statics__[templateName];
        }
        function flatten (requires) {
            var classes = {};
            for (var f in requires)
                for (var c in requires[f])
                    classes[c] = requires[f][c];
            return classes;
        }
    },
    addEvent: function (elem, evName, evFunc) {
        if(elem.attachEvent)
            elem.attachEvent("on" + evName, function() {evFunc.call(elem);});
        else
            elem.addEventListener(evName, evFunc, false);
    },
    getCookie: function (str) {
        return this.getCookieJar()[str] || "";
    },
    setCookie: function (cookie, value, length) {
        var now = new Date();
        now.setDate(now.getDate() + (length ? length : 30));
        document.cookie=cookie + "=" + value + "; expires=" + now.toUTCString() + "; path=/";
    },
    getCookieJar: function ()
    {
        var cookies = document.cookie.split(";");
        var jar = new Object();
        for (var i = 0; i < cookies.length; ++i)
            if (cookies[i].match(/[ ]*(.*?)=(.*)/))
                jar[RegExp.$1] = RegExp.$2;
        return jar;
    }
}

