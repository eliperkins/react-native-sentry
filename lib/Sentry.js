import {
    NativeModules
} from 'react-native';
import Raven from 'raven-js';;

const {
    RNSentry
} = NativeModules;

const DEFAULT_MODULE_IGNORES = [
    "AccessibilityManager",
    "ActionSheetManager",
    "AlertManager",
    "AppState",
    "AsyncLocalStorage",
    "Clipboard",
    "DevLoadingView",
    "DevMenu",
    "ExceptionsManager",
    "I18nManager",
    "ImageEditingManager",
    "ImageStoreManager",
    "ImageViewManager",
    "IOSConstants",
    "JSCExecutor",
    "JSCSamplingProfiler",
    "KeyboardObserver",
    "LinkingManager",
    "LocationObserver",
    "NativeAnimatedModule",
    "NavigatorManager",
    "NetInfo",
    "Networking",
    "RedBox",
    "ScrollViewManager",
    "SettingsManager",
    "SourceCode",
    "StatusBarManager",
    "Timing",
    "UIManager",
    "Vibration",
    "WebSocketModule",
    "WebViewManager"
];

export const SentrySeverity = {
    Fatal: 0,
    Error: 1,
    Warning: 2,
    Info: 3,
    Debug: 4
}

export const SentryLog = {
    None: 0,
    Error: 1,
    Debug: 2,
    Verbose: 3
}

export class Sentry {
    static install() {
        if (RNSentry && RNSentry.nativeClientAvailable && Sentry.options.forceRavenClient === false) {
            Sentry._client = new NativeClient(Sentry._dsn, Sentry.options);
        } else {
            Sentry._client = new RavenClient(Sentry._dsn, Sentry.options);
        }
    }

    static config(dsn, options) {
        if (dsn.constructor !== String) {
            throw new Error('Sentry: A DSN must be provided');
        }
        Sentry._dsn = dsn;
        Sentry.options = {
            logLevel: SentryLog.None,
            forceRavenClient: false,
        }
        Object.assign(Sentry.options, options);
        Sentry._originalConsole = console || {};
        return Sentry;
    }

    static crash = () => {
        Sentry._client.crash();
    }

    static nativeCrash = () => {
        Sentry._client.nativeCrash();
    }

    static setUserContext = (user) => {
        Sentry._client.setUserContext(user);
    }

    static setTagsContext = (tags) => {
        Sentry._client.setTagsContext(tags);
    }

    static setExtraContext = (extras) => {
        Sentry._client.setExtraContext(extras);
    }

    static captureMessage = (message, options) => {
        Sentry._client.captureMessage(message, options);
    }

    static log = (level, message) => {
        if (Sentry.options && Sentry.options.logLevel) {
            if (Sentry.options.logLevel < level) {
                return;
            }
            Sentry._originalConsole.log(message);
        }
    }
}

class NativeClient {
    constructor(dsn, options) {
        if (dsn.constructor !== String) {
            throw new Error('Sentry: A DSN must be provided');
        }
        if (!RNSentry) {
            throw new Error('Sentry: There is no native client installed.');
        }

        this._dsn = dsn;
        this._activatedMerging = false;
        this.options = {
            ignoreModulesExclude: [],
            ignoreModulesInclude: [],
            deactivateStacktraceMerging: false
        }
        Object.assign(this.options, options);

        RNSentry.startWithDsnString(this._dsn);
        if (this.options.deactivateStacktraceMerging === false) {
            this._activateStacktraceMerging();
        }
    }

    crash = () => {
        Sentry.log(SentryLog.Debug, 'Sentry: NativeClient: call crash');
        throw new Error('Sentry: NativeClient: TEST crash');
    }

    nativeCrash = () => {
        Sentry.log(SentryLog.Debug, 'Sentry: NativeClient: call nativeCrash');
        RNSentry.crash();
    }

    setUserContext = (user) => {
        Sentry.log(SentryLog.Debug, ['Sentry: NativeClient: call setUserContext', user]);
        RNSentry.setUser(user);
    }

    setTagsContext = (tags) => {
        Sentry.log(SentryLog.Debug, ['Sentry: NativeClient: call setTagsContext', tags]);
        RNSentry.setTags(tags);
    }

    setExtraContext = (extras) => {
        Sentry.log(SentryLog.Debug, ['Sentry: NativeClient: call setExtraContext', extras]);
        RNSentry.setExtras(extras);
    }

    captureMessage = (message, options) => {
        Sentry.log(SentryLog.Debug, ['Sentry: NativeClient: call captureMessage', message, options]);
        if (options === undefined) {
            options = {
                level: SentrySeverity.Error
            };
        }
        RNSentry.captureMessage(message, options.level);
    }

    _activateStacktraceMerging = async() => {
        Sentry.log(SentryLog.Debug, 'Sentry: NativeClient: call _activateStacktraceMerging');
        return RNSentry.activateStacktraceMerging().then(activated => {
            if (this._activatedMerging) {
                return;
            }
            this._ignoredModules = {};
            __fbBatchedBridgeConfig.remoteModuleConfig.forEach((module, moduleID) => {
                if (module !== null &&
                    this.options.ignoreModulesExclude.indexOf(module[0]) == -1 &&
                    (DEFAULT_MODULE_IGNORES.indexOf(module[0]) >= 0 ||
                        this.options.ignoreModulesInclude.indexOf(module[0]) >= 0)) {
                    this._ignoredModules[moduleID] = true;
                }
            });
            this._activatedMerging = true;
            this._overwriteEnqueueNativeCall();
        });
    }

    _overwriteEnqueueNativeCall = () => {
        const BatchedBridge = require('react-native/Libraries/BatchedBridge/BatchedBridge');
        const original = BatchedBridge.enqueueNativeCall;
        const that = this;
        BatchedBridge.enqueueNativeCall = function(moduleID: number, methodID: number, params: Array < any > , onFail: ? Function, onSucc : ? Function) {
            if (that._ignoredModules[moduleID]) {
                return original.apply(this, arguments);
            }
            params.push({
                '__sentry_stack': new Error().stack
            });
            return original.apply(this, arguments);
        }
    }
}

class RavenClient {
    constructor(dsn, options) {
        if (dsn.constructor !== String) {
            throw new Error('SentryClient: A DSN must be provided');
        }
        this._dsn = dsn;
        this.options = {
            allowSecretKey: true,
        }
        Object.assign(this.options, options);
        Raven.addPlugin(require('./raven-plugin'));
        Raven.config(dsn, this.options).install();
    }

    crash = () => {
        Sentry.log(SentryLog.Debug, 'Sentry: RavenClient: call crash');
        throw new Error("Sentry: RavenClient: TEST crash");
    }

    nativeCrash = () => {
        /*eslint no-console:0*/
        window.console && console.error && console.error("nativeCrash is not support with the RavenClient");
    }

    setUserContext = (user) => {
        Sentry.log(SentryLog.Debug, ['Sentry: RavenClient: call setUserContext', user]);
        Raven.setUserContext(user);
    }

    setTagsContext = (tags) => {
        Sentry.log(SentryLog.Debug, ['Sentry: RavenClient: call setTagsContext', tags]);
        Raven.setTagsContext(tags);
    }

    setExtraContext = (extras) => {
        Sentry.log(SentryLog.Debug, ['Sentry: RavenClient: call setExtraContext', extras]);
        Raven.setExtraContext(extras)
    }

    captureMessage = async(message, options) => {
        Sentry.log(SentryLog.Debug, ['Sentry: RavenClient: call captureMessage', message, options]);
        if (options && options.level) {
            switch (options.level) {
                case SentrySeverity.Warning:
                    options.level = 'warning';
                    break;
                case SentrySeverity.Info:
                    options.level = 'info';
                    break;
                default:
                    options.level = 'error';
            }
        }
        Raven.captureMessage(message, options);
    }
}
