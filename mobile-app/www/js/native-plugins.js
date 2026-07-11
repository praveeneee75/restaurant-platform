(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // node_modules/@capacitor/core/dist/index.js
  var ExceptionCode, CapacitorException, getPlatformId, createCapacitor, initCapacitorGlobal, Capacitor, registerPlugin, WebPlugin, encode, decode, CapacitorCookiesPluginWeb, CapacitorCookies, readBlobAsBase64, normalizeHttpHeaders, buildUrlParams, buildRequestInit, CapacitorHttpPluginWeb, CapacitorHttp;
  var init_dist = __esm({
    "node_modules/@capacitor/core/dist/index.js"() {
      (function(ExceptionCode2) {
        ExceptionCode2["Unimplemented"] = "UNIMPLEMENTED";
        ExceptionCode2["Unavailable"] = "UNAVAILABLE";
      })(ExceptionCode || (ExceptionCode = {}));
      CapacitorException = class extends Error {
        constructor(message, code, data) {
          super(message);
          this.message = message;
          this.code = code;
          this.data = data;
        }
      };
      getPlatformId = (win) => {
        var _a, _b;
        if (win === null || win === void 0 ? void 0 : win.androidBridge) {
          return "android";
        } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
          return "ios";
        } else {
          return "web";
        }
      };
      createCapacitor = (win) => {
        const capCustomPlatform = win.CapacitorCustomPlatform || null;
        const cap = win.Capacitor || {};
        const Plugins = cap.Plugins = cap.Plugins || {};
        const getPlatform = () => {
          return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
        };
        const isNativePlatform = () => getPlatform() !== "web";
        const isPluginAvailable = (pluginName) => {
          const plugin = registeredPlugins.get(pluginName);
          if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
            return true;
          }
          if (getPluginHeader(pluginName)) {
            return true;
          }
          return false;
        };
        const getPluginHeader = (pluginName) => {
          var _a;
          return (_a = cap.PluginHeaders) === null || _a === void 0 ? void 0 : _a.find((h) => h.name === pluginName);
        };
        const handleError = (err) => win.console.error(err);
        const registeredPlugins = /* @__PURE__ */ new Map();
        const registerPlugin2 = (pluginName, jsImplementations = {}) => {
          const registeredPlugin = registeredPlugins.get(pluginName);
          if (registeredPlugin) {
            console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
            return registeredPlugin.proxy;
          }
          const platform = getPlatform();
          const pluginHeader = getPluginHeader(pluginName);
          let jsImplementation;
          const loadPluginImplementation = async () => {
            if (!jsImplementation && platform in jsImplementations) {
              jsImplementation = typeof jsImplementations[platform] === "function" ? jsImplementation = await jsImplementations[platform]() : jsImplementation = jsImplementations[platform];
            } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
              jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
            }
            return jsImplementation;
          };
          const createPluginMethod = (impl, prop) => {
            var _a, _b;
            if (pluginHeader) {
              const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
              if (methodHeader) {
                if (methodHeader.rtype === "promise") {
                  return (options) => cap.nativePromise(pluginName, prop.toString(), options);
                } else {
                  return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
                }
              } else if (impl) {
                return (_a = impl[prop]) === null || _a === void 0 ? void 0 : _a.bind(impl);
              }
            } else if (impl) {
              return (_b = impl[prop]) === null || _b === void 0 ? void 0 : _b.bind(impl);
            } else {
              throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform}`, ExceptionCode.Unimplemented);
            }
          };
          const createPluginMethodWrapper = (prop) => {
            let remove;
            const wrapper = (...args) => {
              const p = loadPluginImplementation().then((impl) => {
                const fn = createPluginMethod(impl, prop);
                if (fn) {
                  const p2 = fn(...args);
                  remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
                  return p2;
                } else {
                  throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform}`, ExceptionCode.Unimplemented);
                }
              });
              if (prop === "addListener") {
                p.remove = async () => remove();
              }
              return p;
            };
            wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
            Object.defineProperty(wrapper, "name", {
              value: prop,
              writable: false,
              configurable: false
            });
            return wrapper;
          };
          const addListener = createPluginMethodWrapper("addListener");
          const removeListener = createPluginMethodWrapper("removeListener");
          const addListenerNative = (eventName, callback) => {
            const call = addListener({ eventName }, callback);
            const remove = async () => {
              const callbackId = await call;
              removeListener({
                eventName,
                callbackId
              }, callback);
            };
            const p = new Promise((resolve) => call.then(() => resolve({ remove })));
            p.remove = async () => {
              console.warn(`Using addListener() without 'await' is deprecated.`);
              await remove();
            };
            return p;
          };
          const proxy3 = new Proxy({}, {
            get(_, prop) {
              switch (prop) {
                // https://github.com/facebook/react/issues/20030
                case "$$typeof":
                  return void 0;
                case "toJSON":
                  return () => ({});
                case "addListener":
                  return pluginHeader ? addListenerNative : addListener;
                case "removeListener":
                  return removeListener;
                default:
                  return createPluginMethodWrapper(prop);
              }
            }
          });
          Plugins[pluginName] = proxy3;
          registeredPlugins.set(pluginName, {
            name: pluginName,
            proxy: proxy3,
            platforms: /* @__PURE__ */ new Set([...Object.keys(jsImplementations), ...pluginHeader ? [platform] : []])
          });
          return proxy3;
        };
        if (!cap.convertFileSrc) {
          cap.convertFileSrc = (filePath) => filePath;
        }
        cap.getPlatform = getPlatform;
        cap.handleError = handleError;
        cap.isNativePlatform = isNativePlatform;
        cap.isPluginAvailable = isPluginAvailable;
        cap.registerPlugin = registerPlugin2;
        cap.Exception = CapacitorException;
        cap.DEBUG = !!cap.DEBUG;
        cap.isLoggingEnabled = !!cap.isLoggingEnabled;
        return cap;
      };
      initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
      Capacitor = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      registerPlugin = Capacitor.registerPlugin;
      WebPlugin = class {
        constructor() {
          this.listeners = {};
          this.retainedEventArguments = {};
          this.windowListeners = {};
        }
        addListener(eventName, listenerFunc) {
          let firstListener = false;
          const listeners = this.listeners[eventName];
          if (!listeners) {
            this.listeners[eventName] = [];
            firstListener = true;
          }
          this.listeners[eventName].push(listenerFunc);
          const windowListener = this.windowListeners[eventName];
          if (windowListener && !windowListener.registered) {
            this.addWindowListener(windowListener);
          }
          if (firstListener) {
            this.sendRetainedArgumentsForEvent(eventName);
          }
          const remove = async () => this.removeListener(eventName, listenerFunc);
          const p = Promise.resolve({ remove });
          return p;
        }
        async removeAllListeners() {
          this.listeners = {};
          for (const listener in this.windowListeners) {
            this.removeWindowListener(this.windowListeners[listener]);
          }
          this.windowListeners = {};
        }
        notifyListeners(eventName, data, retainUntilConsumed) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            if (retainUntilConsumed) {
              let args = this.retainedEventArguments[eventName];
              if (!args) {
                args = [];
              }
              args.push(data);
              this.retainedEventArguments[eventName] = args;
            }
            return;
          }
          listeners.forEach((listener) => listener(data));
        }
        hasListeners(eventName) {
          var _a;
          return !!((_a = this.listeners[eventName]) === null || _a === void 0 ? void 0 : _a.length);
        }
        registerWindowListener(windowEventName, pluginEventName) {
          this.windowListeners[pluginEventName] = {
            registered: false,
            windowEventName,
            pluginEventName,
            handler: (event) => {
              this.notifyListeners(pluginEventName, event);
            }
          };
        }
        unimplemented(msg = "not implemented") {
          return new Capacitor.Exception(msg, ExceptionCode.Unimplemented);
        }
        unavailable(msg = "not available") {
          return new Capacitor.Exception(msg, ExceptionCode.Unavailable);
        }
        async removeListener(eventName, listenerFunc) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            return;
          }
          const index = listeners.indexOf(listenerFunc);
          this.listeners[eventName].splice(index, 1);
          if (!this.listeners[eventName].length) {
            this.removeWindowListener(this.windowListeners[eventName]);
          }
        }
        addWindowListener(handle) {
          window.addEventListener(handle.windowEventName, handle.handler);
          handle.registered = true;
        }
        removeWindowListener(handle) {
          if (!handle) {
            return;
          }
          window.removeEventListener(handle.windowEventName, handle.handler);
          handle.registered = false;
        }
        sendRetainedArgumentsForEvent(eventName) {
          const args = this.retainedEventArguments[eventName];
          if (!args) {
            return;
          }
          delete this.retainedEventArguments[eventName];
          args.forEach((arg) => {
            this.notifyListeners(eventName, arg);
          });
        }
      };
      encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
      decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
      CapacitorCookiesPluginWeb = class extends WebPlugin {
        async getCookies() {
          const cookies = document.cookie;
          const cookieMap = {};
          cookies.split(";").forEach((cookie) => {
            if (cookie.length <= 0)
              return;
            let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
            key = decode(key).trim();
            value = decode(value).trim();
            cookieMap[key] = value;
          });
          return cookieMap;
        }
        async setCookie(options) {
          try {
            const encodedKey = encode(options.key);
            const encodedValue = encode(options.value);
            const expires = options.expires ? `; expires=${options.expires.replace("expires=", "")}` : "";
            const path = (options.path || "/").replace("path=", "");
            const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
            document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path}; ${domain};`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async deleteCookie(options) {
          try {
            document.cookie = `${options.key}=; Max-Age=0`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearCookies() {
          try {
            const cookies = document.cookie.split(";") || [];
            for (const cookie of cookies) {
              document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
            }
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearAllCookies() {
          try {
            await this.clearCookies();
          } catch (error) {
            return Promise.reject(error);
          }
        }
      };
      CapacitorCookies = registerPlugin("CapacitorCookies", {
        web: () => new CapacitorCookiesPluginWeb()
      });
      readBlobAsBase64 = async (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64String = reader.result;
          resolve(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
      });
      normalizeHttpHeaders = (headers = {}) => {
        const originalKeys = Object.keys(headers);
        const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
        const normalized = loweredKeys.reduce((acc, key, index) => {
          acc[key] = headers[originalKeys[index]];
          return acc;
        }, {});
        return normalized;
      };
      buildUrlParams = (params, shouldEncode = true) => {
        if (!params)
          return null;
        const output = Object.entries(params).reduce((accumulator, entry) => {
          const [key, value] = entry;
          let encodedValue;
          let item;
          if (Array.isArray(value)) {
            item = "";
            value.forEach((str) => {
              encodedValue = shouldEncode ? encodeURIComponent(str) : str;
              item += `${key}=${encodedValue}&`;
            });
            item.slice(0, -1);
          } else {
            encodedValue = shouldEncode ? encodeURIComponent(value) : value;
            item = `${key}=${encodedValue}`;
          }
          return `${accumulator}&${item}`;
        }, "");
        return output.substr(1);
      };
      buildRequestInit = (options, extra = {}) => {
        const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
        const headers = normalizeHttpHeaders(options.headers);
        const type = headers["content-type"] || "";
        if (typeof options.data === "string") {
          output.body = options.data;
        } else if (type.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(options.data || {})) {
            params.set(key, value);
          }
          output.body = params.toString();
        } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
          const form = new FormData();
          if (options.data instanceof FormData) {
            options.data.forEach((value, key) => {
              form.append(key, value);
            });
          } else {
            for (const key of Object.keys(options.data)) {
              form.append(key, options.data[key]);
            }
          }
          output.body = form;
          const headers2 = new Headers(output.headers);
          headers2.delete("content-type");
          output.headers = headers2;
        } else if (type.includes("application/json") || typeof options.data === "object") {
          output.body = JSON.stringify(options.data);
        }
        return output;
      };
      CapacitorHttpPluginWeb = class extends WebPlugin {
        /**
         * Perform an Http request given a set of options
         * @param options Options to build the HTTP request
         */
        async request(options) {
          const requestInit = buildRequestInit(options, options.webFetchExtra);
          const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
          const url = urlParams ? `${options.url}?${urlParams}` : options.url;
          const response = await fetch(url, requestInit);
          const contentType = response.headers.get("content-type") || "";
          let { responseType = "text" } = response.ok ? options : {};
          if (contentType.includes("application/json")) {
            responseType = "json";
          }
          let data;
          let blob;
          switch (responseType) {
            case "arraybuffer":
            case "blob":
              blob = await response.blob();
              data = await readBlobAsBase64(blob);
              break;
            case "json":
              data = await response.json();
              break;
            case "document":
            case "text":
            default:
              data = await response.text();
          }
          const headers = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          return {
            data,
            headers,
            status: response.status,
            url: response.url
          };
        }
        /**
         * Perform an Http GET request given a set of options
         * @param options Options to build the HTTP request
         */
        async get(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
        }
        /**
         * Perform an Http POST request given a set of options
         * @param options Options to build the HTTP request
         */
        async post(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
        }
        /**
         * Perform an Http PUT request given a set of options
         * @param options Options to build the HTTP request
         */
        async put(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
        }
        /**
         * Perform an Http PATCH request given a set of options
         * @param options Options to build the HTTP request
         */
        async patch(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
        }
        /**
         * Perform an Http DELETE request given a set of options
         * @param options Options to build the HTTP request
         */
        async delete(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
        }
      };
      CapacitorHttp = registerPlugin("CapacitorHttp", {
        web: () => new CapacitorHttpPluginWeb()
      });
    }
  });

  // node_modules/@aparajita/capacitor-biometric-auth/dist/esm/definitions.js
  function isBiometryErrorType(value) {
    return typeof value === "string" && // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    Object.values(BiometryErrorType).includes(value);
  }
  var BiometryType, AndroidBiometryStrength, BiometryErrorType, BiometryError;
  var init_definitions = __esm({
    "node_modules/@aparajita/capacitor-biometric-auth/dist/esm/definitions.js"() {
      (function(BiometryType2) {
        BiometryType2[BiometryType2["none"] = 0] = "none";
        BiometryType2[BiometryType2["touchId"] = 1] = "touchId";
        BiometryType2[BiometryType2["faceId"] = 2] = "faceId";
        BiometryType2[BiometryType2["fingerprintAuthentication"] = 3] = "fingerprintAuthentication";
        BiometryType2[BiometryType2["faceAuthentication"] = 4] = "faceAuthentication";
        BiometryType2[BiometryType2["irisAuthentication"] = 5] = "irisAuthentication";
      })(BiometryType || (BiometryType = {}));
      (function(AndroidBiometryStrength2) {
        AndroidBiometryStrength2[AndroidBiometryStrength2["weak"] = 0] = "weak";
        AndroidBiometryStrength2[AndroidBiometryStrength2["strong"] = 1] = "strong";
      })(AndroidBiometryStrength || (AndroidBiometryStrength = {}));
      (function(BiometryErrorType2) {
        BiometryErrorType2["none"] = "";
        BiometryErrorType2["appCancel"] = "appCancel";
        BiometryErrorType2["authenticationFailed"] = "authenticationFailed";
        BiometryErrorType2["invalidContext"] = "invalidContext";
        BiometryErrorType2["notInteractive"] = "notInteractive";
        BiometryErrorType2["passcodeNotSet"] = "passcodeNotSet";
        BiometryErrorType2["systemCancel"] = "systemCancel";
        BiometryErrorType2["userCancel"] = "userCancel";
        BiometryErrorType2["userFallback"] = "userFallback";
        BiometryErrorType2["biometryLockout"] = "biometryLockout";
        BiometryErrorType2["biometryNotAvailable"] = "biometryNotAvailable";
        BiometryErrorType2["biometryNotEnrolled"] = "biometryNotEnrolled";
        BiometryErrorType2["noDeviceCredential"] = "noDeviceCredential";
      })(BiometryErrorType || (BiometryErrorType = {}));
      BiometryError = class _BiometryError extends Error {
        constructor(message, code) {
          super(message);
          this.code = code;
          this.name = "BiometryError";
          Object.setPrototypeOf(this, _BiometryError.prototype);
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-biometric-auth/dist/esm/web-utils.js
  function getBiometryName(type) {
    return kBiometryTypeNameMap[type] || "";
  }
  var kBiometryTypeNameMap;
  var init_web_utils = __esm({
    "node_modules/@aparajita/capacitor-biometric-auth/dist/esm/web-utils.js"() {
      init_definitions();
      kBiometryTypeNameMap = {
        [BiometryType.none]: "",
        [BiometryType.touchId]: "Touch ID",
        [BiometryType.faceId]: "Face ID",
        [BiometryType.fingerprintAuthentication]: "Fingerprint Authentication",
        [BiometryType.faceAuthentication]: "Face Authentication",
        [BiometryType.irisAuthentication]: "Iris Authentication"
      };
    }
  });

  // node_modules/@capacitor/app/dist/esm/definitions.js
  var init_definitions2 = __esm({
    "node_modules/@capacitor/app/dist/esm/definitions.js"() {
    }
  });

  // node_modules/@capacitor/app/dist/esm/web.js
  var web_exports = {};
  __export(web_exports, {
    AppWeb: () => AppWeb
  });
  var AppWeb;
  var init_web = __esm({
    "node_modules/@capacitor/app/dist/esm/web.js"() {
      init_dist();
      AppWeb = class extends WebPlugin {
        constructor() {
          super();
          this.handleVisibilityChange = () => {
            const data = {
              isActive: document.hidden !== true
            };
            this.notifyListeners("appStateChange", data);
            if (document.hidden) {
              this.notifyListeners("pause", null);
            } else {
              this.notifyListeners("resume", null);
            }
          };
          document.addEventListener("visibilitychange", this.handleVisibilityChange, false);
        }
        exitApp() {
          throw this.unimplemented("Not implemented on web.");
        }
        async getInfo() {
          throw this.unimplemented("Not implemented on web.");
        }
        async getLaunchUrl() {
          return { url: "" };
        }
        async getState() {
          return { isActive: document.hidden !== true };
        }
        async minimizeApp() {
          throw this.unimplemented("Not implemented on web.");
        }
        async toggleBackButtonHandler() {
          throw this.unimplemented("Not implemented on web.");
        }
      };
    }
  });

  // node_modules/@capacitor/app/dist/esm/index.js
  var App;
  var init_esm = __esm({
    "node_modules/@capacitor/app/dist/esm/index.js"() {
      init_dist();
      init_definitions2();
      App = registerPlugin("App", {
        web: () => Promise.resolve().then(() => (init_web(), web_exports)).then((m) => new m.AppWeb())
      });
    }
  });

  // node_modules/@aparajita/capacitor-biometric-auth/dist/esm/base.js
  var BiometricAuthBase;
  var init_base = __esm({
    "node_modules/@aparajita/capacitor-biometric-auth/dist/esm/base.js"() {
      init_esm();
      init_dist();
      init_definitions();
      BiometricAuthBase = class extends WebPlugin {
        async authenticate(options) {
          try {
            await this.internalAuthenticate(options);
          } catch (error) {
            throw error instanceof CapacitorException && isBiometryErrorType(error.code) ? new BiometryError(error.message, error.code) : error;
          }
        }
        async addResumeListener(listener) {
          return App.addListener("appStateChange", ({ isActive }) => {
            if (isActive) {
              ;
              (async () => {
                try {
                  const info = await this.checkBiometry();
                  listener(info);
                } catch (error) {
                  console.error(error);
                }
              })();
            }
          });
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-biometric-auth/dist/esm/web.js
  var web_exports2 = {};
  __export(web_exports2, {
    BiometricAuthWeb: () => BiometricAuthWeb
  });
  function isBiometryType(value) {
    return Object.values(BiometryType).includes(value);
  }
  function isBiometryTypes(value) {
    return value.every((type) => isBiometryType(type));
  }
  var BiometricAuthWeb;
  var init_web2 = __esm({
    "node_modules/@aparajita/capacitor-biometric-auth/dist/esm/web.js"() {
      init_base();
      init_definitions();
      init_web_utils();
      BiometricAuthWeb = class extends BiometricAuthBase {
        constructor() {
          super(...arguments);
          this.biometryType = BiometryType.none;
          this.biometryTypes = [];
          this.biometryIsEnrolled = false;
          this.deviceIsSecure = false;
        }
        // On the web, return the fake biometry set by setBiometryType().
        async checkBiometry() {
          const hasBiometry = this.biometryType !== BiometryType.none;
          const available = hasBiometry && this.biometryIsEnrolled;
          let reason = "";
          let code = BiometryErrorType.none;
          if (!hasBiometry) {
            reason = "No biometry is available";
            code = BiometryErrorType.biometryNotAvailable;
          } else if (!this.biometryIsEnrolled) {
            reason = "Biometry is not enrolled";
            code = BiometryErrorType.biometryNotEnrolled;
          }
          return {
            isAvailable: available,
            strongBiometryIsAvailable: this.biometryIsEnrolled && this.hasStrongBiometry(),
            biometryType: this.biometryType,
            biometryTypes: this.biometryTypes,
            deviceIsSecure: this.deviceIsSecure,
            reason,
            code
          };
        }
        hasStrongBiometry() {
          return this.biometryTypes.some((type) => type === BiometryType.faceId || type === BiometryType.touchId || type === BiometryType.fingerprintAuthentication);
        }
        // On the web, fake authentication with a confirm dialog.
        async internalAuthenticate(options) {
          const result = await this.checkBiometry();
          if (result.isAvailable && // oxlint-disable-next-line no-alert
          confirm(
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- we want to use the default value if options?.reason is an empty string
            (options === null || options === void 0 ? void 0 : options.reason) || `Authenticate with ${result.biometryTypes.map((type) => getBiometryName(type)).join(" or ")}?`
          )) {
            return;
          }
          if (options === null || options === void 0 ? void 0 : options.allowDeviceCredential) {
            if (result.deviceIsSecure) {
              if (confirm("Authenticate with device security?")) {
                return;
              }
              throw new BiometryError("User cancelled", BiometryErrorType.userCancel);
            } else if (result.isAvailable) {
              throw new BiometryError("Device is not secure", BiometryErrorType.noDeviceCredential);
            }
          } else if (!result.isAvailable) {
            throw result.biometryType === BiometryType.none ? new BiometryError("Biometry is not available", BiometryErrorType.biometryNotAvailable) : new BiometryError("Biometry is not enrolled", BiometryErrorType.biometryNotEnrolled);
          }
          throw new BiometryError("User cancelled", BiometryErrorType.userCancel);
        }
        // Web only, used for simulating biometric authentication.
        async setBiometryType(type) {
          if (type === void 0) {
            return;
          }
          const types = Array.isArray(type) ? type : [type];
          this.biometryTypes = [];
          this.biometryType = BiometryType.none;
          if (types.length === 0) {
            return;
          }
          if (isBiometryTypes(types)) {
            this.biometryType = types[0];
            if (this.biometryType !== BiometryType.none) {
              this.biometryTypes = types;
            }
          } else {
            for (const [i, theType] of types.entries()) {
              if (isBiometryType(theType)) {
                if (this.biometryType === BiometryType.none) {
                  this.biometryTypes = [];
                } else {
                  this.biometryTypes.push(theType);
                }
                if (i === 0) {
                  this.biometryType = theType;
                }
              }
            }
          }
        }
        // Web only, used for simulating device unlock security.
        async setBiometryIsEnrolled(enrolled) {
          this.biometryIsEnrolled = enrolled;
        }
        // Web only, used for simulating device unlock security.
        async setDeviceIsSecure(isSecure) {
          this.deviceIsSecure = isSecure;
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-biometric-auth/dist/esm/native.js
  var native_exports = {};
  __export(native_exports, {
    BiometricAuthNative: () => BiometricAuthNative
  });
  var BiometricAuthNative;
  var init_native = __esm({
    "node_modules/@aparajita/capacitor-biometric-auth/dist/esm/native.js"() {
      init_base();
      init_definitions();
      BiometricAuthNative = class extends BiometricAuthBase {
        constructor(capProxy) {
          super();
          const proxy3 = capProxy;
          this.checkBiometry = proxy3.checkBiometry;
          this.internalAuthenticate = proxy3.internalAuthenticate;
        }
        // @native
        async checkBiometry() {
          return {
            isAvailable: false,
            strongBiometryIsAvailable: false,
            biometryType: BiometryType.none,
            biometryTypes: [],
            deviceIsSecure: false,
            reason: "",
            code: BiometryErrorType.none,
            strongReason: "",
            strongCode: BiometryErrorType.none
          };
        }
        // @native
        // On native platforms, this will present the native authentication UI.
        async internalAuthenticate(_options) {
        }
        // Web only, used for simulating biometric authentication.
        async setBiometryType(_type) {
          console.warn("setBiometryType() is web only");
        }
        // Web only, used for simulating biometry enrollment.
        async setBiometryIsEnrolled(_enrolled) {
          console.warn("setBiometryEnrolled() is web only");
        }
        // Web only, used for simulating device security.
        async setDeviceIsSecure(_isSecure) {
          console.warn("setDeviceIsSecure() is web only");
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/definitions.js
  var StorageErrorType, KeychainAccess, StorageError;
  var init_definitions3 = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/definitions.js"() {
      (function(StorageErrorType2) {
        StorageErrorType2["missingKey"] = "missingKey";
        StorageErrorType2["invalidData"] = "invalidData";
        StorageErrorType2["osError"] = "osError";
        StorageErrorType2["unknownError"] = "unknownError";
      })(StorageErrorType || (StorageErrorType = {}));
      (function(KeychainAccess2) {
        KeychainAccess2[KeychainAccess2["whenUnlocked"] = 0] = "whenUnlocked";
        KeychainAccess2[KeychainAccess2["whenUnlockedThisDeviceOnly"] = 1] = "whenUnlockedThisDeviceOnly";
        KeychainAccess2[KeychainAccess2["afterFirstUnlock"] = 2] = "afterFirstUnlock";
        KeychainAccess2[KeychainAccess2["afterFirstUnlockThisDeviceOnly"] = 3] = "afterFirstUnlockThisDeviceOnly";
        KeychainAccess2[KeychainAccess2["whenPasscodeSetThisDeviceOnly"] = 4] = "whenPasscodeSetThisDeviceOnly";
      })(KeychainAccess || (KeychainAccess = {}));
      StorageError = class extends Error {
        constructor(message, code) {
          super(message);
          this.name = "StorageError";
          this.code = code;
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/base.js
  function isStorageErrorType(value) {
    return value !== void 0 && Object.keys(StorageErrorType).includes(value);
  }
  function parseISODate(isoDate) {
    const match = isoDateRE.exec(isoDate);
    if (match) {
      const year = Number.parseInt(match[1], 10);
      const month = Number.parseInt(match[2], 10) - 1;
      const day = Number.parseInt(match[3], 10);
      const hour = Number.parseInt(match[4], 10);
      const minute = Number.parseInt(match[5], 10);
      const second = Number.parseInt(match[6], 10);
      const millis = Number.parseInt(match[7], 10);
      const epochTime = Date.UTC(year, month, day, hour, minute, second, millis);
      return new Date(epochTime);
    }
    return null;
  }
  var SecureStorageBase, isoDateRE;
  var init_base2 = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/base.js"() {
      init_dist();
      init_definitions3();
      SecureStorageBase = class _SecureStorageBase extends WebPlugin {
        constructor() {
          super(...arguments);
          this.prefix = "capacitor-storage_";
          this.sync = false;
          this.access = KeychainAccess.whenUnlocked;
        }
        async setSynchronize(sync) {
          this.sync = sync;
          if (Capacitor.getPlatform() === "ios") {
            return this.setSynchronizeKeychain({ sync });
          }
        }
        async getSynchronize() {
          return this.sync;
        }
        async setDefaultKeychainAccess(access) {
          this.access = access;
        }
        async tryOperation(operation) {
          try {
            return await operation();
          } catch (error) {
            if (error instanceof CapacitorException && isStorageErrorType(error.code)) {
              throw new StorageError(error.message, error.code);
            }
            throw error;
          }
        }
        async get(key, convertDate = true, sync) {
          if (key) {
            const { data } = await this.tryOperation(async () => this.internalGetItem({
              prefixedKey: this.prefixedKey(key),
              sync: sync !== null && sync !== void 0 ? sync : this.sync
            }));
            if (data === null) {
              return null;
            }
            if (convertDate) {
              const date = parseISODate(data);
              if (date) {
                return date;
              }
            }
            try {
              return JSON.parse(data);
            } catch (_a) {
              throw new StorageError("Invalid data", StorageErrorType.invalidData);
            }
          }
          return _SecureStorageBase.missingKey();
        }
        async getItem(key) {
          if (key) {
            const { data } = await this.tryOperation(async () => this.internalGetItem({
              prefixedKey: this.prefixedKey(key),
              sync: this.sync
            }));
            return data;
          }
          return null;
        }
        async set(key, data, convertDate = true, sync, access) {
          if (key) {
            let convertedData = data;
            if (convertDate && data instanceof Date) {
              convertedData = data.toISOString();
            }
            return this.tryOperation(async () => this.internalSetItem({
              prefixedKey: this.prefixedKey(key),
              data: JSON.stringify(convertedData),
              sync: sync !== null && sync !== void 0 ? sync : this.sync,
              access: access !== null && access !== void 0 ? access : this.access
            }));
          }
          return _SecureStorageBase.missingKey();
        }
        async setItem(key, value) {
          if (key) {
            return this.tryOperation(async () => this.internalSetItem({
              prefixedKey: this.prefixedKey(key),
              data: value,
              sync: this.sync,
              access: this.access
            }));
          }
          return _SecureStorageBase.missingKey();
        }
        async remove(key, sync) {
          if (key) {
            const { success } = await this.tryOperation(async () => this.internalRemoveItem({
              prefixedKey: this.prefixedKey(key),
              sync: sync !== null && sync !== void 0 ? sync : this.sync
            }));
            return success;
          }
          return _SecureStorageBase.missingKey();
        }
        async removeItem(key) {
          if (key) {
            await this.tryOperation(async () => this.internalRemoveItem({
              prefixedKey: this.prefixedKey(key),
              sync: this.sync
            }));
            return;
          }
          _SecureStorageBase.missingKey();
        }
        async keys(sync) {
          const { keys } = await this.tryOperation(async () => this.getPrefixedKeys({
            prefix: this.prefix,
            sync: sync !== null && sync !== void 0 ? sync : this.sync
          }));
          const prefixLength = this.prefix.length;
          return keys.map((key) => key.slice(prefixLength));
        }
        async getKeyPrefix() {
          return this.prefix;
        }
        async setKeyPrefix(prefix) {
          this.prefix = prefix;
        }
        prefixedKey(key) {
          return this.prefix + key;
        }
        static missingKey() {
          throw new StorageError("No key provided", StorageErrorType.missingKey);
        }
      };
      isoDateRE = /^"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).(\d{3})Z"$/u;
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/web.js
  var web_exports3 = {};
  __export(web_exports3, {
    SecureStorageWeb: () => SecureStorageWeb
  });
  var SecureStorageWeb;
  var init_web3 = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/web.js"() {
      init_base2();
      SecureStorageWeb = class extends SecureStorageBase {
        // @native
        /* eslint-disable @typescript-eslint/class-methods-use-this */
        async setSynchronizeKeychain(_options) {
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async internalGetItem(options) {
          return { data: localStorage.getItem(options.prefixedKey) };
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async internalSetItem(options) {
          localStorage.setItem(options.prefixedKey, options.data);
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async internalRemoveItem(options) {
          const item = localStorage.getItem(options.prefixedKey);
          if (item !== null) {
            localStorage.removeItem(options.prefixedKey);
            return { success: true };
          }
          return { success: false };
        }
        async clear() {
          const { keys } = await this.getPrefixedKeys({ prefix: this.prefix });
          for (const key of keys) {
            localStorage.removeItem(key);
          }
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async clearItemsWithPrefix(_options) {
          console.warn("clearItemsWithPrefix is native only");
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async getPrefixedKeys(options) {
          const keys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key === null || key === void 0 ? void 0 : key.startsWith(options.prefix)) {
              keys.push(key);
            }
          }
          return { keys };
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/native.js
  var native_exports2 = {};
  __export(native_exports2, {
    SecureStorageNative: () => SecureStorageNative
  });
  var SecureStorageNative;
  var init_native2 = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/native.js"() {
      init_base2();
      SecureStorageNative = class extends SecureStorageBase {
        constructor(capProxy) {
          super();
          const proxy3 = capProxy;
          this.setSynchronizeKeychain = proxy3.setSynchronizeKeychain;
          this.internalGetItem = proxy3.internalGetItem;
          this.internalSetItem = proxy3.internalSetItem;
          this.internalRemoveItem = proxy3.internalRemoveItem;
          this.clearItemsWithPrefix = proxy3.clearItemsWithPrefix;
          this.getPrefixedKeys = proxy3.getPrefixedKeys;
        }
        // @native
        /* eslint-disable @typescript-eslint/class-methods-use-this */
        async setSynchronizeKeychain(_options) {
        }
        // @native
        async internalGetItem(_options) {
          return { data: "" };
        }
        // @native
        async internalSetItem(_options) {
        }
        // @native
        async internalRemoveItem(_options) {
          return { success: true };
        }
        async clear(sync) {
          return this.tryOperation(async () => this.clearItemsWithPrefix({
            prefix: this.prefix,
            sync: sync !== null && sync !== void 0 ? sync : this.sync
          }));
        }
        // @native
        async clearItemsWithPrefix(_options) {
        }
        // @native
        async getPrefixedKeys(_options) {
          return { keys: [] };
        }
      };
    }
  });

  // src/native-plugins.js
  init_dist();

  // node_modules/@aparajita/capacitor-biometric-auth/dist/esm/index.js
  init_dist();
  init_definitions();
  init_web_utils();
  var proxy = registerPlugin("BiometricAuthNative", {
    web: async () => {
      const module = await Promise.resolve().then(() => (init_web2(), web_exports2));
      return new module.BiometricAuthWeb();
    },
    ios: async () => {
      const module = await Promise.resolve().then(() => (init_native(), native_exports));
      return new module.BiometricAuthNative(proxy);
    },
    android: async () => {
      const module = await Promise.resolve().then(() => (init_native(), native_exports));
      return new module.BiometricAuthNative(proxy);
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/index.js
  init_dist();
  init_definitions3();
  var proxy2 = registerPlugin("SecureStorage", {
    web: async () => {
      const module = await Promise.resolve().then(() => (init_web3(), web_exports3));
      return new module.SecureStorageWeb();
    },
    ios: async () => {
      const module = await Promise.resolve().then(() => (init_native2(), native_exports2));
      return new module.SecureStorageNative(proxy2);
    },
    android: async () => {
      const module = await Promise.resolve().then(() => (init_native2(), native_exports2));
      return new module.SecureStorageNative(proxy2);
    }
  });

  // src/native-plugins.js
  window.KMasterNative = {
    isNative: Capacitor.isNativePlatform(),
    platform: Capacitor.getPlatform(),
    biometric: proxy,
    secureStorage: proxy2
  };
})();
/*! Bundled license information:

@capacitor/core/dist/index.js:
  (*! Capacitor: https://capacitorjs.com/ - MIT License *)
*/
