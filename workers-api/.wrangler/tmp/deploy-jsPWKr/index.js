var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/bcryptjs/dist/bcrypt.js
var require_bcrypt = __commonJS({
  "node_modules/bcryptjs/dist/bcrypt.js"(exports, module) {
    (function(global, factory) {
      if (typeof define === "function" && define["amd"])
        define([], factory);
      else if (typeof __require === "function" && typeof module === "object" && module && module["exports"])
        module["exports"] = factory();
      else
        (global["dcodeIO"] = global["dcodeIO"] || {})["bcrypt"] = factory();
    })(exports, function() {
      "use strict";
      var bcrypt3 = {};
      var randomFallback = null;
      function random(len) {
        if (typeof module !== "undefined" && module && module["exports"])
          try {
            return __require("crypto")["randomBytes"](len);
          } catch (e) {
          }
        try {
          var a;
          (self["crypto"] || self["msCrypto"])["getRandomValues"](a = new Uint32Array(len));
          return Array.prototype.slice.call(a);
        } catch (e) {
        }
        if (!randomFallback)
          throw Error("Neither WebCryptoAPI nor a crypto module is available. Use bcrypt.setRandomFallback to set an alternative");
        return randomFallback(len);
      }
      __name(random, "random");
      var randomAvailable = false;
      try {
        random(1);
        randomAvailable = true;
      } catch (e) {
      }
      randomFallback = null;
      bcrypt3.setRandomFallback = function(random2) {
        randomFallback = random2;
      };
      bcrypt3.genSaltSync = function(rounds, seed_length) {
        rounds = rounds || GENSALT_DEFAULT_LOG2_ROUNDS;
        if (typeof rounds !== "number")
          throw Error("Illegal arguments: " + typeof rounds + ", " + typeof seed_length);
        if (rounds < 4)
          rounds = 4;
        else if (rounds > 31)
          rounds = 31;
        var salt = [];
        salt.push("$2a$");
        if (rounds < 10)
          salt.push("0");
        salt.push(rounds.toString());
        salt.push("$");
        salt.push(base64_encode(random(BCRYPT_SALT_LEN), BCRYPT_SALT_LEN));
        return salt.join("");
      };
      bcrypt3.genSalt = function(rounds, seed_length, callback) {
        if (typeof seed_length === "function")
          callback = seed_length, seed_length = void 0;
        if (typeof rounds === "function")
          callback = rounds, rounds = void 0;
        if (typeof rounds === "undefined")
          rounds = GENSALT_DEFAULT_LOG2_ROUNDS;
        else if (typeof rounds !== "number")
          throw Error("illegal arguments: " + typeof rounds);
        function _async(callback2) {
          nextTick(function() {
            try {
              callback2(null, bcrypt3.genSaltSync(rounds));
            } catch (err) {
              callback2(err);
            }
          });
        }
        __name(_async, "_async");
        if (callback) {
          if (typeof callback !== "function")
            throw Error("Illegal callback: " + typeof callback);
          _async(callback);
        } else
          return new Promise(function(resolve, reject) {
            _async(function(err, res) {
              if (err) {
                reject(err);
                return;
              }
              resolve(res);
            });
          });
      };
      bcrypt3.hashSync = function(s, salt) {
        if (typeof salt === "undefined")
          salt = GENSALT_DEFAULT_LOG2_ROUNDS;
        if (typeof salt === "number")
          salt = bcrypt3.genSaltSync(salt);
        if (typeof s !== "string" || typeof salt !== "string")
          throw Error("Illegal arguments: " + typeof s + ", " + typeof salt);
        return _hash(s, salt);
      };
      bcrypt3.hash = function(s, salt, callback, progressCallback) {
        function _async(callback2) {
          if (typeof s === "string" && typeof salt === "number")
            bcrypt3.genSalt(salt, function(err, salt2) {
              _hash(s, salt2, callback2, progressCallback);
            });
          else if (typeof s === "string" && typeof salt === "string")
            _hash(s, salt, callback2, progressCallback);
          else
            nextTick(callback2.bind(this, Error("Illegal arguments: " + typeof s + ", " + typeof salt)));
        }
        __name(_async, "_async");
        if (callback) {
          if (typeof callback !== "function")
            throw Error("Illegal callback: " + typeof callback);
          _async(callback);
        } else
          return new Promise(function(resolve, reject) {
            _async(function(err, res) {
              if (err) {
                reject(err);
                return;
              }
              resolve(res);
            });
          });
      };
      function safeStringCompare(known, unknown) {
        var right = 0, wrong = 0;
        for (var i = 0, k = known.length; i < k; ++i) {
          if (known.charCodeAt(i) === unknown.charCodeAt(i))
            ++right;
          else
            ++wrong;
        }
        if (right < 0)
          return false;
        return wrong === 0;
      }
      __name(safeStringCompare, "safeStringCompare");
      bcrypt3.compareSync = function(s, hash) {
        if (typeof s !== "string" || typeof hash !== "string")
          throw Error("Illegal arguments: " + typeof s + ", " + typeof hash);
        if (hash.length !== 60)
          return false;
        return safeStringCompare(bcrypt3.hashSync(s, hash.substr(0, hash.length - 31)), hash);
      };
      bcrypt3.compare = function(s, hash, callback, progressCallback) {
        function _async(callback2) {
          if (typeof s !== "string" || typeof hash !== "string") {
            nextTick(callback2.bind(this, Error("Illegal arguments: " + typeof s + ", " + typeof hash)));
            return;
          }
          if (hash.length !== 60) {
            nextTick(callback2.bind(this, null, false));
            return;
          }
          bcrypt3.hash(s, hash.substr(0, 29), function(err, comp) {
            if (err)
              callback2(err);
            else
              callback2(null, safeStringCompare(comp, hash));
          }, progressCallback);
        }
        __name(_async, "_async");
        if (callback) {
          if (typeof callback !== "function")
            throw Error("Illegal callback: " + typeof callback);
          _async(callback);
        } else
          return new Promise(function(resolve, reject) {
            _async(function(err, res) {
              if (err) {
                reject(err);
                return;
              }
              resolve(res);
            });
          });
      };
      bcrypt3.getRounds = function(hash) {
        if (typeof hash !== "string")
          throw Error("Illegal arguments: " + typeof hash);
        return parseInt(hash.split("$")[2], 10);
      };
      bcrypt3.getSalt = function(hash) {
        if (typeof hash !== "string")
          throw Error("Illegal arguments: " + typeof hash);
        if (hash.length !== 60)
          throw Error("Illegal hash length: " + hash.length + " != 60");
        return hash.substring(0, 29);
      };
      var nextTick = typeof process !== "undefined" && process && typeof process.nextTick === "function" ? typeof setImmediate === "function" ? setImmediate : process.nextTick : setTimeout;
      function stringToBytes(str) {
        var out = [], i = 0;
        utfx.encodeUTF16toUTF8(function() {
          if (i >= str.length) return null;
          return str.charCodeAt(i++);
        }, function(b) {
          out.push(b);
        });
        return out;
      }
      __name(stringToBytes, "stringToBytes");
      var BASE64_CODE = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split("");
      var BASE64_INDEX = [
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        0,
        1,
        54,
        55,
        56,
        57,
        58,
        59,
        60,
        61,
        62,
        63,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16,
        17,
        18,
        19,
        20,
        21,
        22,
        23,
        24,
        25,
        26,
        27,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        28,
        29,
        30,
        31,
        32,
        33,
        34,
        35,
        36,
        37,
        38,
        39,
        40,
        41,
        42,
        43,
        44,
        45,
        46,
        47,
        48,
        49,
        50,
        51,
        52,
        53,
        -1,
        -1,
        -1,
        -1,
        -1
      ];
      var stringFromCharCode = String.fromCharCode;
      function base64_encode(b, len) {
        var off = 0, rs = [], c1, c2;
        if (len <= 0 || len > b.length)
          throw Error("Illegal len: " + len);
        while (off < len) {
          c1 = b[off++] & 255;
          rs.push(BASE64_CODE[c1 >> 2 & 63]);
          c1 = (c1 & 3) << 4;
          if (off >= len) {
            rs.push(BASE64_CODE[c1 & 63]);
            break;
          }
          c2 = b[off++] & 255;
          c1 |= c2 >> 4 & 15;
          rs.push(BASE64_CODE[c1 & 63]);
          c1 = (c2 & 15) << 2;
          if (off >= len) {
            rs.push(BASE64_CODE[c1 & 63]);
            break;
          }
          c2 = b[off++] & 255;
          c1 |= c2 >> 6 & 3;
          rs.push(BASE64_CODE[c1 & 63]);
          rs.push(BASE64_CODE[c2 & 63]);
        }
        return rs.join("");
      }
      __name(base64_encode, "base64_encode");
      function base64_decode(s, len) {
        var off = 0, slen = s.length, olen = 0, rs = [], c1, c2, c3, c4, o, code;
        if (len <= 0)
          throw Error("Illegal len: " + len);
        while (off < slen - 1 && olen < len) {
          code = s.charCodeAt(off++);
          c1 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
          code = s.charCodeAt(off++);
          c2 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
          if (c1 == -1 || c2 == -1)
            break;
          o = c1 << 2 >>> 0;
          o |= (c2 & 48) >> 4;
          rs.push(stringFromCharCode(o));
          if (++olen >= len || off >= slen)
            break;
          code = s.charCodeAt(off++);
          c3 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
          if (c3 == -1)
            break;
          o = (c2 & 15) << 4 >>> 0;
          o |= (c3 & 60) >> 2;
          rs.push(stringFromCharCode(o));
          if (++olen >= len || off >= slen)
            break;
          code = s.charCodeAt(off++);
          c4 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
          o = (c3 & 3) << 6 >>> 0;
          o |= c4;
          rs.push(stringFromCharCode(o));
          ++olen;
        }
        var res = [];
        for (off = 0; off < olen; off++)
          res.push(rs[off].charCodeAt(0));
        return res;
      }
      __name(base64_decode, "base64_decode");
      var utfx = (function() {
        "use strict";
        var utfx2 = {};
        utfx2.MAX_CODEPOINT = 1114111;
        utfx2.encodeUTF8 = function(src, dst) {
          var cp = null;
          if (typeof src === "number")
            cp = src, src = /* @__PURE__ */ __name(function() {
              return null;
            }, "src");
          while (cp !== null || (cp = src()) !== null) {
            if (cp < 128)
              dst(cp & 127);
            else if (cp < 2048)
              dst(cp >> 6 & 31 | 192), dst(cp & 63 | 128);
            else if (cp < 65536)
              dst(cp >> 12 & 15 | 224), dst(cp >> 6 & 63 | 128), dst(cp & 63 | 128);
            else
              dst(cp >> 18 & 7 | 240), dst(cp >> 12 & 63 | 128), dst(cp >> 6 & 63 | 128), dst(cp & 63 | 128);
            cp = null;
          }
        };
        utfx2.decodeUTF8 = function(src, dst) {
          var a, b, c, d, fail = /* @__PURE__ */ __name(function(b2) {
            b2 = b2.slice(0, b2.indexOf(null));
            var err = Error(b2.toString());
            err.name = "TruncatedError";
            err["bytes"] = b2;
            throw err;
          }, "fail");
          while ((a = src()) !== null) {
            if ((a & 128) === 0)
              dst(a);
            else if ((a & 224) === 192)
              (b = src()) === null && fail([a, b]), dst((a & 31) << 6 | b & 63);
            else if ((a & 240) === 224)
              ((b = src()) === null || (c = src()) === null) && fail([a, b, c]), dst((a & 15) << 12 | (b & 63) << 6 | c & 63);
            else if ((a & 248) === 240)
              ((b = src()) === null || (c = src()) === null || (d = src()) === null) && fail([a, b, c, d]), dst((a & 7) << 18 | (b & 63) << 12 | (c & 63) << 6 | d & 63);
            else throw RangeError("Illegal starting byte: " + a);
          }
        };
        utfx2.UTF16toUTF8 = function(src, dst) {
          var c1, c2 = null;
          while (true) {
            if ((c1 = c2 !== null ? c2 : src()) === null)
              break;
            if (c1 >= 55296 && c1 <= 57343) {
              if ((c2 = src()) !== null) {
                if (c2 >= 56320 && c2 <= 57343) {
                  dst((c1 - 55296) * 1024 + c2 - 56320 + 65536);
                  c2 = null;
                  continue;
                }
              }
            }
            dst(c1);
          }
          if (c2 !== null) dst(c2);
        };
        utfx2.UTF8toUTF16 = function(src, dst) {
          var cp = null;
          if (typeof src === "number")
            cp = src, src = /* @__PURE__ */ __name(function() {
              return null;
            }, "src");
          while (cp !== null || (cp = src()) !== null) {
            if (cp <= 65535)
              dst(cp);
            else
              cp -= 65536, dst((cp >> 10) + 55296), dst(cp % 1024 + 56320);
            cp = null;
          }
        };
        utfx2.encodeUTF16toUTF8 = function(src, dst) {
          utfx2.UTF16toUTF8(src, function(cp) {
            utfx2.encodeUTF8(cp, dst);
          });
        };
        utfx2.decodeUTF8toUTF16 = function(src, dst) {
          utfx2.decodeUTF8(src, function(cp) {
            utfx2.UTF8toUTF16(cp, dst);
          });
        };
        utfx2.calculateCodePoint = function(cp) {
          return cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
        };
        utfx2.calculateUTF8 = function(src) {
          var cp, l = 0;
          while ((cp = src()) !== null)
            l += utfx2.calculateCodePoint(cp);
          return l;
        };
        utfx2.calculateUTF16asUTF8 = function(src) {
          var n = 0, l = 0;
          utfx2.UTF16toUTF8(src, function(cp) {
            ++n;
            l += utfx2.calculateCodePoint(cp);
          });
          return [n, l];
        };
        return utfx2;
      })();
      Date.now = Date.now || function() {
        return +/* @__PURE__ */ new Date();
      };
      var BCRYPT_SALT_LEN = 16;
      var GENSALT_DEFAULT_LOG2_ROUNDS = 10;
      var BLOWFISH_NUM_ROUNDS = 16;
      var MAX_EXECUTION_TIME = 100;
      var P_ORIG = [
        608135816,
        2242054355,
        320440878,
        57701188,
        2752067618,
        698298832,
        137296536,
        3964562569,
        1160258022,
        953160567,
        3193202383,
        887688300,
        3232508343,
        3380367581,
        1065670069,
        3041331479,
        2450970073,
        2306472731
      ];
      var S_ORIG = [
        3509652390,
        2564797868,
        805139163,
        3491422135,
        3101798381,
        1780907670,
        3128725573,
        4046225305,
        614570311,
        3012652279,
        134345442,
        2240740374,
        1667834072,
        1901547113,
        2757295779,
        4103290238,
        227898511,
        1921955416,
        1904987480,
        2182433518,
        2069144605,
        3260701109,
        2620446009,
        720527379,
        3318853667,
        677414384,
        3393288472,
        3101374703,
        2390351024,
        1614419982,
        1822297739,
        2954791486,
        3608508353,
        3174124327,
        2024746970,
        1432378464,
        3864339955,
        2857741204,
        1464375394,
        1676153920,
        1439316330,
        715854006,
        3033291828,
        289532110,
        2706671279,
        2087905683,
        3018724369,
        1668267050,
        732546397,
        1947742710,
        3462151702,
        2609353502,
        2950085171,
        1814351708,
        2050118529,
        680887927,
        999245976,
        1800124847,
        3300911131,
        1713906067,
        1641548236,
        4213287313,
        1216130144,
        1575780402,
        4018429277,
        3917837745,
        3693486850,
        3949271944,
        596196993,
        3549867205,
        258830323,
        2213823033,
        772490370,
        2760122372,
        1774776394,
        2652871518,
        566650946,
        4142492826,
        1728879713,
        2882767088,
        1783734482,
        3629395816,
        2517608232,
        2874225571,
        1861159788,
        326777828,
        3124490320,
        2130389656,
        2716951837,
        967770486,
        1724537150,
        2185432712,
        2364442137,
        1164943284,
        2105845187,
        998989502,
        3765401048,
        2244026483,
        1075463327,
        1455516326,
        1322494562,
        910128902,
        469688178,
        1117454909,
        936433444,
        3490320968,
        3675253459,
        1240580251,
        122909385,
        2157517691,
        634681816,
        4142456567,
        3825094682,
        3061402683,
        2540495037,
        79693498,
        3249098678,
        1084186820,
        1583128258,
        426386531,
        1761308591,
        1047286709,
        322548459,
        995290223,
        1845252383,
        2603652396,
        3431023940,
        2942221577,
        3202600964,
        3727903485,
        1712269319,
        422464435,
        3234572375,
        1170764815,
        3523960633,
        3117677531,
        1434042557,
        442511882,
        3600875718,
        1076654713,
        1738483198,
        4213154764,
        2393238008,
        3677496056,
        1014306527,
        4251020053,
        793779912,
        2902807211,
        842905082,
        4246964064,
        1395751752,
        1040244610,
        2656851899,
        3396308128,
        445077038,
        3742853595,
        3577915638,
        679411651,
        2892444358,
        2354009459,
        1767581616,
        3150600392,
        3791627101,
        3102740896,
        284835224,
        4246832056,
        1258075500,
        768725851,
        2589189241,
        3069724005,
        3532540348,
        1274779536,
        3789419226,
        2764799539,
        1660621633,
        3471099624,
        4011903706,
        913787905,
        3497959166,
        737222580,
        2514213453,
        2928710040,
        3937242737,
        1804850592,
        3499020752,
        2949064160,
        2386320175,
        2390070455,
        2415321851,
        4061277028,
        2290661394,
        2416832540,
        1336762016,
        1754252060,
        3520065937,
        3014181293,
        791618072,
        3188594551,
        3933548030,
        2332172193,
        3852520463,
        3043980520,
        413987798,
        3465142937,
        3030929376,
        4245938359,
        2093235073,
        3534596313,
        375366246,
        2157278981,
        2479649556,
        555357303,
        3870105701,
        2008414854,
        3344188149,
        4221384143,
        3956125452,
        2067696032,
        3594591187,
        2921233993,
        2428461,
        544322398,
        577241275,
        1471733935,
        610547355,
        4027169054,
        1432588573,
        1507829418,
        2025931657,
        3646575487,
        545086370,
        48609733,
        2200306550,
        1653985193,
        298326376,
        1316178497,
        3007786442,
        2064951626,
        458293330,
        2589141269,
        3591329599,
        3164325604,
        727753846,
        2179363840,
        146436021,
        1461446943,
        4069977195,
        705550613,
        3059967265,
        3887724982,
        4281599278,
        3313849956,
        1404054877,
        2845806497,
        146425753,
        1854211946,
        1266315497,
        3048417604,
        3681880366,
        3289982499,
        290971e4,
        1235738493,
        2632868024,
        2414719590,
        3970600049,
        1771706367,
        1449415276,
        3266420449,
        422970021,
        1963543593,
        2690192192,
        3826793022,
        1062508698,
        1531092325,
        1804592342,
        2583117782,
        2714934279,
        4024971509,
        1294809318,
        4028980673,
        1289560198,
        2221992742,
        1669523910,
        35572830,
        157838143,
        1052438473,
        1016535060,
        1802137761,
        1753167236,
        1386275462,
        3080475397,
        2857371447,
        1040679964,
        2145300060,
        2390574316,
        1461121720,
        2956646967,
        4031777805,
        4028374788,
        33600511,
        2920084762,
        1018524850,
        629373528,
        3691585981,
        3515945977,
        2091462646,
        2486323059,
        586499841,
        988145025,
        935516892,
        3367335476,
        2599673255,
        2839830854,
        265290510,
        3972581182,
        2759138881,
        3795373465,
        1005194799,
        847297441,
        406762289,
        1314163512,
        1332590856,
        1866599683,
        4127851711,
        750260880,
        613907577,
        1450815602,
        3165620655,
        3734664991,
        3650291728,
        3012275730,
        3704569646,
        1427272223,
        778793252,
        1343938022,
        2676280711,
        2052605720,
        1946737175,
        3164576444,
        3914038668,
        3967478842,
        3682934266,
        1661551462,
        3294938066,
        4011595847,
        840292616,
        3712170807,
        616741398,
        312560963,
        711312465,
        1351876610,
        322626781,
        1910503582,
        271666773,
        2175563734,
        1594956187,
        70604529,
        3617834859,
        1007753275,
        1495573769,
        4069517037,
        2549218298,
        2663038764,
        504708206,
        2263041392,
        3941167025,
        2249088522,
        1514023603,
        1998579484,
        1312622330,
        694541497,
        2582060303,
        2151582166,
        1382467621,
        776784248,
        2618340202,
        3323268794,
        2497899128,
        2784771155,
        503983604,
        4076293799,
        907881277,
        423175695,
        432175456,
        1378068232,
        4145222326,
        3954048622,
        3938656102,
        3820766613,
        2793130115,
        2977904593,
        26017576,
        3274890735,
        3194772133,
        1700274565,
        1756076034,
        4006520079,
        3677328699,
        720338349,
        1533947780,
        354530856,
        688349552,
        3973924725,
        1637815568,
        332179504,
        3949051286,
        53804574,
        2852348879,
        3044236432,
        1282449977,
        3583942155,
        3416972820,
        4006381244,
        1617046695,
        2628476075,
        3002303598,
        1686838959,
        431878346,
        2686675385,
        1700445008,
        1080580658,
        1009431731,
        832498133,
        3223435511,
        2605976345,
        2271191193,
        2516031870,
        1648197032,
        4164389018,
        2548247927,
        300782431,
        375919233,
        238389289,
        3353747414,
        2531188641,
        2019080857,
        1475708069,
        455242339,
        2609103871,
        448939670,
        3451063019,
        1395535956,
        2413381860,
        1841049896,
        1491858159,
        885456874,
        4264095073,
        4001119347,
        1565136089,
        3898914787,
        1108368660,
        540939232,
        1173283510,
        2745871338,
        3681308437,
        4207628240,
        3343053890,
        4016749493,
        1699691293,
        1103962373,
        3625875870,
        2256883143,
        3830138730,
        1031889488,
        3479347698,
        1535977030,
        4236805024,
        3251091107,
        2132092099,
        1774941330,
        1199868427,
        1452454533,
        157007616,
        2904115357,
        342012276,
        595725824,
        1480756522,
        206960106,
        497939518,
        591360097,
        863170706,
        2375253569,
        3596610801,
        1814182875,
        2094937945,
        3421402208,
        1082520231,
        3463918190,
        2785509508,
        435703966,
        3908032597,
        1641649973,
        2842273706,
        3305899714,
        1510255612,
        2148256476,
        2655287854,
        3276092548,
        4258621189,
        236887753,
        3681803219,
        274041037,
        1734335097,
        3815195456,
        3317970021,
        1899903192,
        1026095262,
        4050517792,
        356393447,
        2410691914,
        3873677099,
        3682840055,
        3913112168,
        2491498743,
        4132185628,
        2489919796,
        1091903735,
        1979897079,
        3170134830,
        3567386728,
        3557303409,
        857797738,
        1136121015,
        1342202287,
        507115054,
        2535736646,
        337727348,
        3213592640,
        1301675037,
        2528481711,
        1895095763,
        1721773893,
        3216771564,
        62756741,
        2142006736,
        835421444,
        2531993523,
        1442658625,
        3659876326,
        2882144922,
        676362277,
        1392781812,
        170690266,
        3921047035,
        1759253602,
        3611846912,
        1745797284,
        664899054,
        1329594018,
        3901205900,
        3045908486,
        2062866102,
        2865634940,
        3543621612,
        3464012697,
        1080764994,
        553557557,
        3656615353,
        3996768171,
        991055499,
        499776247,
        1265440854,
        648242737,
        3940784050,
        980351604,
        3713745714,
        1749149687,
        3396870395,
        4211799374,
        3640570775,
        1161844396,
        3125318951,
        1431517754,
        545492359,
        4268468663,
        3499529547,
        1437099964,
        2702547544,
        3433638243,
        2581715763,
        2787789398,
        1060185593,
        1593081372,
        2418618748,
        4260947970,
        69676912,
        2159744348,
        86519011,
        2512459080,
        3838209314,
        1220612927,
        3339683548,
        133810670,
        1090789135,
        1078426020,
        1569222167,
        845107691,
        3583754449,
        4072456591,
        1091646820,
        628848692,
        1613405280,
        3757631651,
        526609435,
        236106946,
        48312990,
        2942717905,
        3402727701,
        1797494240,
        859738849,
        992217954,
        4005476642,
        2243076622,
        3870952857,
        3732016268,
        765654824,
        3490871365,
        2511836413,
        1685915746,
        3888969200,
        1414112111,
        2273134842,
        3281911079,
        4080962846,
        172450625,
        2569994100,
        980381355,
        4109958455,
        2819808352,
        2716589560,
        2568741196,
        3681446669,
        3329971472,
        1835478071,
        660984891,
        3704678404,
        4045999559,
        3422617507,
        3040415634,
        1762651403,
        1719377915,
        3470491036,
        2693910283,
        3642056355,
        3138596744,
        1364962596,
        2073328063,
        1983633131,
        926494387,
        3423689081,
        2150032023,
        4096667949,
        1749200295,
        3328846651,
        309677260,
        2016342300,
        1779581495,
        3079819751,
        111262694,
        1274766160,
        443224088,
        298511866,
        1025883608,
        3806446537,
        1145181785,
        168956806,
        3641502830,
        3584813610,
        1689216846,
        3666258015,
        3200248200,
        1692713982,
        2646376535,
        4042768518,
        1618508792,
        1610833997,
        3523052358,
        4130873264,
        2001055236,
        3610705100,
        2202168115,
        4028541809,
        2961195399,
        1006657119,
        2006996926,
        3186142756,
        1430667929,
        3210227297,
        1314452623,
        4074634658,
        4101304120,
        2273951170,
        1399257539,
        3367210612,
        3027628629,
        1190975929,
        2062231137,
        2333990788,
        2221543033,
        2438960610,
        1181637006,
        548689776,
        2362791313,
        3372408396,
        3104550113,
        3145860560,
        296247880,
        1970579870,
        3078560182,
        3769228297,
        1714227617,
        3291629107,
        3898220290,
        166772364,
        1251581989,
        493813264,
        448347421,
        195405023,
        2709975567,
        677966185,
        3703036547,
        1463355134,
        2715995803,
        1338867538,
        1343315457,
        2802222074,
        2684532164,
        233230375,
        2599980071,
        2000651841,
        3277868038,
        1638401717,
        4028070440,
        3237316320,
        6314154,
        819756386,
        300326615,
        590932579,
        1405279636,
        3267499572,
        3150704214,
        2428286686,
        3959192993,
        3461946742,
        1862657033,
        1266418056,
        963775037,
        2089974820,
        2263052895,
        1917689273,
        448879540,
        3550394620,
        3981727096,
        150775221,
        3627908307,
        1303187396,
        508620638,
        2975983352,
        2726630617,
        1817252668,
        1876281319,
        1457606340,
        908771278,
        3720792119,
        3617206836,
        2455994898,
        1729034894,
        1080033504,
        976866871,
        3556439503,
        2881648439,
        1522871579,
        1555064734,
        1336096578,
        3548522304,
        2579274686,
        3574697629,
        3205460757,
        3593280638,
        3338716283,
        3079412587,
        564236357,
        2993598910,
        1781952180,
        1464380207,
        3163844217,
        3332601554,
        1699332808,
        1393555694,
        1183702653,
        3581086237,
        1288719814,
        691649499,
        2847557200,
        2895455976,
        3193889540,
        2717570544,
        1781354906,
        1676643554,
        2592534050,
        3230253752,
        1126444790,
        2770207658,
        2633158820,
        2210423226,
        2615765581,
        2414155088,
        3127139286,
        673620729,
        2805611233,
        1269405062,
        4015350505,
        3341807571,
        4149409754,
        1057255273,
        2012875353,
        2162469141,
        2276492801,
        2601117357,
        993977747,
        3918593370,
        2654263191,
        753973209,
        36408145,
        2530585658,
        25011837,
        3520020182,
        2088578344,
        530523599,
        2918365339,
        1524020338,
        1518925132,
        3760827505,
        3759777254,
        1202760957,
        3985898139,
        3906192525,
        674977740,
        4174734889,
        2031300136,
        2019492241,
        3983892565,
        4153806404,
        3822280332,
        352677332,
        2297720250,
        60907813,
        90501309,
        3286998549,
        1016092578,
        2535922412,
        2839152426,
        457141659,
        509813237,
        4120667899,
        652014361,
        1966332200,
        2975202805,
        55981186,
        2327461051,
        676427537,
        3255491064,
        2882294119,
        3433927263,
        1307055953,
        942726286,
        933058658,
        2468411793,
        3933900994,
        4215176142,
        1361170020,
        2001714738,
        2830558078,
        3274259782,
        1222529897,
        1679025792,
        2729314320,
        3714953764,
        1770335741,
        151462246,
        3013232138,
        1682292957,
        1483529935,
        471910574,
        1539241949,
        458788160,
        3436315007,
        1807016891,
        3718408830,
        978976581,
        1043663428,
        3165965781,
        1927990952,
        4200891579,
        2372276910,
        3208408903,
        3533431907,
        1412390302,
        2931980059,
        4132332400,
        1947078029,
        3881505623,
        4168226417,
        2941484381,
        1077988104,
        1320477388,
        886195818,
        18198404,
        3786409e3,
        2509781533,
        112762804,
        3463356488,
        1866414978,
        891333506,
        18488651,
        661792760,
        1628790961,
        3885187036,
        3141171499,
        876946877,
        2693282273,
        1372485963,
        791857591,
        2686433993,
        3759982718,
        3167212022,
        3472953795,
        2716379847,
        445679433,
        3561995674,
        3504004811,
        3574258232,
        54117162,
        3331405415,
        2381918588,
        3769707343,
        4154350007,
        1140177722,
        4074052095,
        668550556,
        3214352940,
        367459370,
        261225585,
        2610173221,
        4209349473,
        3468074219,
        3265815641,
        314222801,
        3066103646,
        3808782860,
        282218597,
        3406013506,
        3773591054,
        379116347,
        1285071038,
        846784868,
        2669647154,
        3771962079,
        3550491691,
        2305946142,
        453669953,
        1268987020,
        3317592352,
        3279303384,
        3744833421,
        2610507566,
        3859509063,
        266596637,
        3847019092,
        517658769,
        3462560207,
        3443424879,
        370717030,
        4247526661,
        2224018117,
        4143653529,
        4112773975,
        2788324899,
        2477274417,
        1456262402,
        2901442914,
        1517677493,
        1846949527,
        2295493580,
        3734397586,
        2176403920,
        1280348187,
        1908823572,
        3871786941,
        846861322,
        1172426758,
        3287448474,
        3383383037,
        1655181056,
        3139813346,
        901632758,
        1897031941,
        2986607138,
        3066810236,
        3447102507,
        1393639104,
        373351379,
        950779232,
        625454576,
        3124240540,
        4148612726,
        2007998917,
        544563296,
        2244738638,
        2330496472,
        2058025392,
        1291430526,
        424198748,
        50039436,
        29584100,
        3605783033,
        2429876329,
        2791104160,
        1057563949,
        3255363231,
        3075367218,
        3463963227,
        1469046755,
        985887462
      ];
      var C_ORIG = [
        1332899944,
        1700884034,
        1701343084,
        1684370003,
        1668446532,
        1869963892
      ];
      function _encipher(lr, off, P, S) {
        var n, l = lr[off], r = lr[off + 1];
        l ^= P[0];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[1];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[2];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[3];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[4];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[5];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[6];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[7];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[8];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[9];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[10];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[11];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[12];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[13];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[14];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[15];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[16];
        lr[off] = r ^ P[BLOWFISH_NUM_ROUNDS + 1];
        lr[off + 1] = l;
        return lr;
      }
      __name(_encipher, "_encipher");
      function _streamtoword(data, offp) {
        for (var i = 0, word = 0; i < 4; ++i)
          word = word << 8 | data[offp] & 255, offp = (offp + 1) % data.length;
        return { key: word, offp };
      }
      __name(_streamtoword, "_streamtoword");
      function _key(key, P, S) {
        var offset = 0, lr = [0, 0], plen = P.length, slen = S.length, sw;
        for (var i = 0; i < plen; i++)
          sw = _streamtoword(key, offset), offset = sw.offp, P[i] = P[i] ^ sw.key;
        for (i = 0; i < plen; i += 2)
          lr = _encipher(lr, 0, P, S), P[i] = lr[0], P[i + 1] = lr[1];
        for (i = 0; i < slen; i += 2)
          lr = _encipher(lr, 0, P, S), S[i] = lr[0], S[i + 1] = lr[1];
      }
      __name(_key, "_key");
      function _ekskey(data, key, P, S) {
        var offp = 0, lr = [0, 0], plen = P.length, slen = S.length, sw;
        for (var i = 0; i < plen; i++)
          sw = _streamtoword(key, offp), offp = sw.offp, P[i] = P[i] ^ sw.key;
        offp = 0;
        for (i = 0; i < plen; i += 2)
          sw = _streamtoword(data, offp), offp = sw.offp, lr[0] ^= sw.key, sw = _streamtoword(data, offp), offp = sw.offp, lr[1] ^= sw.key, lr = _encipher(lr, 0, P, S), P[i] = lr[0], P[i + 1] = lr[1];
        for (i = 0; i < slen; i += 2)
          sw = _streamtoword(data, offp), offp = sw.offp, lr[0] ^= sw.key, sw = _streamtoword(data, offp), offp = sw.offp, lr[1] ^= sw.key, lr = _encipher(lr, 0, P, S), S[i] = lr[0], S[i + 1] = lr[1];
      }
      __name(_ekskey, "_ekskey");
      function _crypt(b, salt, rounds, callback, progressCallback) {
        var cdata = C_ORIG.slice(), clen = cdata.length, err;
        if (rounds < 4 || rounds > 31) {
          err = Error("Illegal number of rounds (4-31): " + rounds);
          if (callback) {
            nextTick(callback.bind(this, err));
            return;
          } else
            throw err;
        }
        if (salt.length !== BCRYPT_SALT_LEN) {
          err = Error("Illegal salt length: " + salt.length + " != " + BCRYPT_SALT_LEN);
          if (callback) {
            nextTick(callback.bind(this, err));
            return;
          } else
            throw err;
        }
        rounds = 1 << rounds >>> 0;
        var P, S, i = 0, j;
        if (Int32Array) {
          P = new Int32Array(P_ORIG);
          S = new Int32Array(S_ORIG);
        } else {
          P = P_ORIG.slice();
          S = S_ORIG.slice();
        }
        _ekskey(salt, b, P, S);
        function next() {
          if (progressCallback)
            progressCallback(i / rounds);
          if (i < rounds) {
            var start = Date.now();
            for (; i < rounds; ) {
              i = i + 1;
              _key(b, P, S);
              _key(salt, P, S);
              if (Date.now() - start > MAX_EXECUTION_TIME)
                break;
            }
          } else {
            for (i = 0; i < 64; i++)
              for (j = 0; j < clen >> 1; j++)
                _encipher(cdata, j << 1, P, S);
            var ret = [];
            for (i = 0; i < clen; i++)
              ret.push((cdata[i] >> 24 & 255) >>> 0), ret.push((cdata[i] >> 16 & 255) >>> 0), ret.push((cdata[i] >> 8 & 255) >>> 0), ret.push((cdata[i] & 255) >>> 0);
            if (callback) {
              callback(null, ret);
              return;
            } else
              return ret;
          }
          if (callback)
            nextTick(next);
        }
        __name(next, "next");
        if (typeof callback !== "undefined") {
          next();
        } else {
          var res;
          while (true)
            if (typeof (res = next()) !== "undefined")
              return res || [];
        }
      }
      __name(_crypt, "_crypt");
      function _hash(s, salt, callback, progressCallback) {
        var err;
        if (typeof s !== "string" || typeof salt !== "string") {
          err = Error("Invalid string / salt: Not a string");
          if (callback) {
            nextTick(callback.bind(this, err));
            return;
          } else
            throw err;
        }
        var minor, offset;
        if (salt.charAt(0) !== "$" || salt.charAt(1) !== "2") {
          err = Error("Invalid salt version: " + salt.substring(0, 2));
          if (callback) {
            nextTick(callback.bind(this, err));
            return;
          } else
            throw err;
        }
        if (salt.charAt(2) === "$")
          minor = String.fromCharCode(0), offset = 3;
        else {
          minor = salt.charAt(2);
          if (minor !== "a" && minor !== "b" && minor !== "y" || salt.charAt(3) !== "$") {
            err = Error("Invalid salt revision: " + salt.substring(2, 4));
            if (callback) {
              nextTick(callback.bind(this, err));
              return;
            } else
              throw err;
          }
          offset = 4;
        }
        if (salt.charAt(offset + 2) > "$") {
          err = Error("Missing salt rounds");
          if (callback) {
            nextTick(callback.bind(this, err));
            return;
          } else
            throw err;
        }
        var r1 = parseInt(salt.substring(offset, offset + 1), 10) * 10, r2 = parseInt(salt.substring(offset + 1, offset + 2), 10), rounds = r1 + r2, real_salt = salt.substring(offset + 3, offset + 25);
        s += minor >= "a" ? "\0" : "";
        var passwordb = stringToBytes(s), saltb = base64_decode(real_salt, BCRYPT_SALT_LEN);
        function finish(bytes) {
          var res = [];
          res.push("$2");
          if (minor >= "a")
            res.push(minor);
          res.push("$");
          if (rounds < 10)
            res.push("0");
          res.push(rounds.toString());
          res.push("$");
          res.push(base64_encode(saltb, saltb.length));
          res.push(base64_encode(bytes, C_ORIG.length * 4 - 1));
          return res.join("");
        }
        __name(finish, "finish");
        if (typeof callback == "undefined")
          return finish(_crypt(passwordb, saltb, rounds));
        else {
          _crypt(passwordb, saltb, rounds, function(err2, bytes) {
            if (err2)
              callback(err2, null);
            else
              callback(null, finish(bytes));
          }, progressCallback);
        }
      }
      __name(_hash, "_hash");
      bcrypt3.encodeBase64 = base64_encode;
      bcrypt3.decodeBase64 = base64_decode;
      return bcrypt3;
    });
  }
});

// node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/buffer.js
var bufferToFormData = /* @__PURE__ */ __name((arrayBuffer, contentType) => {
  const response = new Response(arrayBuffer, {
    headers: {
      // Normalize the media type (case-insensitive) while keeping parameters like the boundary
      "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase())
    }
  });
  return response.formData();
}, "bufferToFormData");

// node_modules/hono/dist/utils/body.js
var isRawRequest = /* @__PURE__ */ __name((request) => "headers" in request, "isRawRequest");
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const contentType = headers.get("Content-Type");
  const mediaType = contentType?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") {
    return parseFormData(request, { all, dot });
  }
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request)) {
    request.bodyCache.formData = formDataPromise;
  }
  const formData = await formDataPromise;
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");

// node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURIComponent_), "tryDecodeURIComponent");
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  }, "#cachedBody");
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * `.bytes()` parses the request body as a `Uint8Array`.
   *
   * @see {@link https://hono.dev/docs/api/request#bytes}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.bytes()
   * })
   * ```
   */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
}, "resolveCallback");

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var createResponseInstance = /* @__PURE__ */ __name((body, init) => new Response(body, init), "createResponseInstance");
var Context = class {
  static {
    __name(this, "Context");
  }
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = /* @__PURE__ */ __name((name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = /* @__PURE__ */ __name((key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  }, "set");
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = /* @__PURE__ */ __name((key) => {
    return this.#var ? this.#var.get(key) : void 0;
  }, "get");
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, { status, headers: responseHeaders });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  }, "text");
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  }, "redirect");
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class _Hono {
  static {
    __name(this, "_Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    }, "handler");
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler, baseRoutePath) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler
    };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = /* @__PURE__ */ __name((input, requestInit, Env11, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env11, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env11,
      executionCtx
    );
  }, "request");
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name(((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }), "match2");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = class _Node {
  static {
    __name(this, "_Node");
  }
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node();
        if (name !== "") {
          node.#varIndex = context.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node();
      }
    }
    node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
__name(clearWildcardRegExpCache, "clearWildcardRegExpCache");
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
__name(buildMatcherFromPreprocessedRoutes, "buildMatcherFromPreprocessedRoutes");
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = /* @__PURE__ */ __name((children) => {
  for (const _ in children) {
    return true;
  }
  return false;
}, "hasChildren");
var Node2 = class _Node2 {
  static {
    __name(this, "_Node");
  }
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  node.#params,
                  params
                );
              }
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  static {
    __name(this, "Hono");
  }
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// node_modules/hono/dist/middleware/cors/index.js
var cors = /* @__PURE__ */ __name((options) => {
  const opts = {
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
    allowHeaders: [],
    exposeHeaders: [],
    ...options
  };
  const findAllowOrigin = ((optsOrigin) => {
    if (typeof optsOrigin === "string") {
      if (optsOrigin === "*") {
        return () => optsOrigin;
      } else {
        return (origin) => optsOrigin === origin ? origin : null;
      }
    } else if (typeof optsOrigin === "function") {
      return optsOrigin;
    } else {
      return (origin) => optsOrigin.includes(origin) ? origin : null;
    }
  })(opts.origin);
  const findAllowMethods = ((optsAllowMethods) => {
    if (typeof optsAllowMethods === "function") {
      return optsAllowMethods;
    } else if (Array.isArray(optsAllowMethods)) {
      return () => optsAllowMethods;
    } else {
      return () => [];
    }
  })(opts.allowMethods);
  return /* @__PURE__ */ __name(async function cors2(c, next) {
    function set(key, value) {
      c.res.headers.set(key, value);
    }
    __name(set, "set");
    const allowOrigin = await findAllowOrigin(c.req.header("origin") || "", c);
    if (allowOrigin) {
      set("Access-Control-Allow-Origin", allowOrigin);
    }
    if (opts.credentials) {
      set("Access-Control-Allow-Credentials", "true");
    }
    if (opts.exposeHeaders?.length) {
      set("Access-Control-Expose-Headers", opts.exposeHeaders.join(","));
    }
    if (c.req.method === "OPTIONS") {
      if (opts.origin !== "*") {
        set("Vary", "Origin");
      }
      if (opts.maxAge != null) {
        set("Access-Control-Max-Age", opts.maxAge.toString());
      }
      const allowMethods = await findAllowMethods(c.req.header("origin") || "", c);
      if (allowMethods.length) {
        set("Access-Control-Allow-Methods", allowMethods.join(","));
      }
      let headers = opts.allowHeaders;
      if (!headers?.length) {
        const requestHeaders = c.req.header("Access-Control-Request-Headers");
        if (requestHeaders) {
          headers = requestHeaders.split(/\s*,\s*/);
        }
      }
      if (headers?.length) {
        set("Access-Control-Allow-Headers", headers.join(","));
        c.res.headers.append("Vary", "Access-Control-Request-Headers");
      }
      c.res.headers.delete("Content-Length");
      c.res.headers.delete("Content-Type");
      return new Response(null, {
        headers: c.res.headers,
        status: 204,
        statusText: "No Content"
      });
    }
    await next();
    if (opts.origin !== "*") {
      c.header("Vary", "Origin", { append: true });
    }
  }, "cors2");
}, "cors");

// node_modules/hono/dist/utils/encode.js
var decodeBase64Url = /* @__PURE__ */ __name((str) => {
  return decodeBase64(str.replace(/_|-/g, (m) => ({ _: "/", "-": "+" })[m] ?? m));
}, "decodeBase64Url");
var encodeBase64Url = /* @__PURE__ */ __name((buf) => encodeBase64(buf).replace(/\/|\+/g, (m) => ({ "/": "_", "+": "-" })[m] ?? m), "encodeBase64Url");
var encodeBase64 = /* @__PURE__ */ __name((buf) => {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0, len = bytes.length; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}, "encodeBase64");
var decodeBase64 = /* @__PURE__ */ __name((str) => {
  const binary = atob(str);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  const half = binary.length / 2;
  for (let i = 0, j = binary.length - 1; i <= half; i++, j--) {
    bytes[i] = binary.charCodeAt(i);
    bytes[j] = binary.charCodeAt(j);
  }
  return bytes;
}, "decodeBase64");

// node_modules/hono/dist/utils/jwt/jwa.js
var AlgorithmTypes = /* @__PURE__ */ ((AlgorithmTypes2) => {
  AlgorithmTypes2["HS256"] = "HS256";
  AlgorithmTypes2["HS384"] = "HS384";
  AlgorithmTypes2["HS512"] = "HS512";
  AlgorithmTypes2["RS256"] = "RS256";
  AlgorithmTypes2["RS384"] = "RS384";
  AlgorithmTypes2["RS512"] = "RS512";
  AlgorithmTypes2["PS256"] = "PS256";
  AlgorithmTypes2["PS384"] = "PS384";
  AlgorithmTypes2["PS512"] = "PS512";
  AlgorithmTypes2["ES256"] = "ES256";
  AlgorithmTypes2["ES384"] = "ES384";
  AlgorithmTypes2["ES512"] = "ES512";
  AlgorithmTypes2["EdDSA"] = "EdDSA";
  return AlgorithmTypes2;
})(AlgorithmTypes || {});

// node_modules/hono/dist/helper/adapter/index.js
var knownUserAgents = {
  deno: "Deno",
  bun: "Bun",
  workerd: "Cloudflare-Workers",
  node: "Node.js"
};
var getRuntimeKey = /* @__PURE__ */ __name(() => {
  const global = globalThis;
  const userAgentSupported = typeof navigator !== "undefined" && true;
  if (userAgentSupported) {
    for (const [runtimeKey, userAgent] of Object.entries(knownUserAgents)) {
      if (checkUserAgentEquals(userAgent)) {
        return runtimeKey;
      }
    }
  }
  if (typeof global?.EdgeRuntime === "string") {
    return "edge-light";
  }
  if (global?.fastly !== void 0) {
    return "fastly";
  }
  if (global?.process?.release?.name === "node") {
    return "node";
  }
  return "other";
}, "getRuntimeKey");
var checkUserAgentEquals = /* @__PURE__ */ __name((platform) => {
  const userAgent = "Cloudflare-Workers";
  return userAgent.startsWith(platform);
}, "checkUserAgentEquals");

// node_modules/hono/dist/utils/jwt/types.js
var JwtAlgorithmNotImplemented = class extends Error {
  static {
    __name(this, "JwtAlgorithmNotImplemented");
  }
  constructor(alg) {
    super(`${alg} is not an implemented algorithm`);
    this.name = "JwtAlgorithmNotImplemented";
  }
};
var JwtAlgorithmRequired = class extends Error {
  static {
    __name(this, "JwtAlgorithmRequired");
  }
  constructor() {
    super('JWT verification requires "alg" option to be specified');
    this.name = "JwtAlgorithmRequired";
  }
};
var JwtAlgorithmMismatch = class extends Error {
  static {
    __name(this, "JwtAlgorithmMismatch");
  }
  constructor(expected, actual) {
    super(`JWT algorithm mismatch: expected "${expected}", got "${actual}"`);
    this.name = "JwtAlgorithmMismatch";
  }
};
var JwtTokenInvalid = class extends Error {
  static {
    __name(this, "JwtTokenInvalid");
  }
  constructor(token) {
    super(`invalid JWT token: ${token}`);
    this.name = "JwtTokenInvalid";
  }
};
var JwtTokenNotBefore = class extends Error {
  static {
    __name(this, "JwtTokenNotBefore");
  }
  constructor(token) {
    super(`token (${token}) is being used before it's valid`);
    this.name = "JwtTokenNotBefore";
  }
};
var JwtTokenExpired = class extends Error {
  static {
    __name(this, "JwtTokenExpired");
  }
  constructor(token) {
    super(`token (${token}) expired`);
    this.name = "JwtTokenExpired";
  }
};
var JwtTokenIssuedAt = class extends Error {
  static {
    __name(this, "JwtTokenIssuedAt");
  }
  constructor(currentTimestamp, iat) {
    super(
      `Invalid "iat" claim, must be a valid number lower than "${currentTimestamp}" (iat: "${iat}")`
    );
    this.name = "JwtTokenIssuedAt";
  }
};
var JwtTokenIssuer = class extends Error {
  static {
    __name(this, "JwtTokenIssuer");
  }
  constructor(expected, iss) {
    super(`expected issuer "${expected}", got ${iss ? `"${iss}"` : "none"} `);
    this.name = "JwtTokenIssuer";
  }
};
var JwtHeaderInvalid = class extends Error {
  static {
    __name(this, "JwtHeaderInvalid");
  }
  constructor(header) {
    super(`jwt header is invalid: ${JSON.stringify(header)}`);
    this.name = "JwtHeaderInvalid";
  }
};
var JwtHeaderRequiresKid = class extends Error {
  static {
    __name(this, "JwtHeaderRequiresKid");
  }
  constructor(header) {
    super(`required "kid" in jwt header: ${JSON.stringify(header)}`);
    this.name = "JwtHeaderRequiresKid";
  }
};
var JwtSymmetricAlgorithmNotAllowed = class extends Error {
  static {
    __name(this, "JwtSymmetricAlgorithmNotAllowed");
  }
  constructor(alg) {
    super(`symmetric algorithm "${alg}" is not allowed for JWK verification`);
    this.name = "JwtSymmetricAlgorithmNotAllowed";
  }
};
var JwtAlgorithmNotAllowed = class extends Error {
  static {
    __name(this, "JwtAlgorithmNotAllowed");
  }
  constructor(alg, allowedAlgorithms) {
    super(`algorithm "${alg}" is not in the allowed list: [${allowedAlgorithms.join(", ")}]`);
    this.name = "JwtAlgorithmNotAllowed";
  }
};
var JwtTokenSignatureMismatched = class extends Error {
  static {
    __name(this, "JwtTokenSignatureMismatched");
  }
  constructor(token) {
    super(`token(${token}) signature mismatched`);
    this.name = "JwtTokenSignatureMismatched";
  }
};
var JwtPayloadRequiresAud = class extends Error {
  static {
    __name(this, "JwtPayloadRequiresAud");
  }
  constructor(payload) {
    super(`required "aud" in jwt payload: ${JSON.stringify(payload)}`);
    this.name = "JwtPayloadRequiresAud";
  }
};
var JwtTokenAudience = class extends Error {
  static {
    __name(this, "JwtTokenAudience");
  }
  constructor(expected, aud) {
    super(
      `expected audience "${Array.isArray(expected) ? expected.join(", ") : expected}", got "${aud}"`
    );
    this.name = "JwtTokenAudience";
  }
};
var CryptoKeyUsage = /* @__PURE__ */ ((CryptoKeyUsage2) => {
  CryptoKeyUsage2["Encrypt"] = "encrypt";
  CryptoKeyUsage2["Decrypt"] = "decrypt";
  CryptoKeyUsage2["Sign"] = "sign";
  CryptoKeyUsage2["Verify"] = "verify";
  CryptoKeyUsage2["DeriveKey"] = "deriveKey";
  CryptoKeyUsage2["DeriveBits"] = "deriveBits";
  CryptoKeyUsage2["WrapKey"] = "wrapKey";
  CryptoKeyUsage2["UnwrapKey"] = "unwrapKey";
  return CryptoKeyUsage2;
})(CryptoKeyUsage || {});

// node_modules/hono/dist/utils/jwt/utf8.js
var utf8Encoder = new TextEncoder();
var utf8Decoder = new TextDecoder();

// node_modules/hono/dist/utils/jwt/jws.js
async function signing(privateKey, alg, data) {
  const algorithm = getKeyAlgorithm(alg);
  const cryptoKey = await importPrivateKey(privateKey, algorithm);
  return await crypto.subtle.sign(algorithm, cryptoKey, data);
}
__name(signing, "signing");
async function verifying(publicKey, alg, signature, data) {
  const algorithm = getKeyAlgorithm(alg);
  const cryptoKey = await importPublicKey(publicKey, algorithm);
  return await crypto.subtle.verify(algorithm, cryptoKey, signature, data);
}
__name(verifying, "verifying");
function pemToBinary(pem) {
  return decodeBase64(pem.replace(/-+(BEGIN|END).*?-+/g, "").replace(/\s/g, ""));
}
__name(pemToBinary, "pemToBinary");
async function importPrivateKey(key, alg) {
  if (!crypto.subtle || !crypto.subtle.importKey) {
    throw new Error("`crypto.subtle.importKey` is undefined. JWT auth middleware requires it.");
  }
  if (isCryptoKey(key)) {
    if (key.type !== "private" && key.type !== "secret") {
      throw new Error(
        `unexpected key type: CryptoKey.type is ${key.type}, expected private or secret`
      );
    }
    return key;
  }
  const usages = [CryptoKeyUsage.Sign];
  if (typeof key === "object") {
    return await crypto.subtle.importKey("jwk", key, alg, false, usages);
  }
  if (key.includes("PRIVATE")) {
    return await crypto.subtle.importKey("pkcs8", pemToBinary(key), alg, false, usages);
  }
  return await crypto.subtle.importKey("raw", utf8Encoder.encode(key), alg, false, usages);
}
__name(importPrivateKey, "importPrivateKey");
async function importPublicKey(key, alg) {
  if (!crypto.subtle || !crypto.subtle.importKey) {
    throw new Error("`crypto.subtle.importKey` is undefined. JWT auth middleware requires it.");
  }
  if (isCryptoKey(key)) {
    if (key.type === "public" || key.type === "secret") {
      return key;
    }
    key = await exportPublicJwkFrom(key);
  }
  if (typeof key === "string" && key.includes("PRIVATE")) {
    const privateKey = await crypto.subtle.importKey("pkcs8", pemToBinary(key), alg, true, [
      CryptoKeyUsage.Sign
    ]);
    key = await exportPublicJwkFrom(privateKey);
  }
  const usages = [CryptoKeyUsage.Verify];
  if (typeof key === "object") {
    return await crypto.subtle.importKey("jwk", key, alg, false, usages);
  }
  if (key.includes("PUBLIC")) {
    return await crypto.subtle.importKey("spki", pemToBinary(key), alg, false, usages);
  }
  return await crypto.subtle.importKey("raw", utf8Encoder.encode(key), alg, false, usages);
}
__name(importPublicKey, "importPublicKey");
async function exportPublicJwkFrom(privateKey) {
  if (privateKey.type !== "private") {
    throw new Error(`unexpected key type: ${privateKey.type}`);
  }
  if (!privateKey.extractable) {
    throw new Error("unexpected private key is unextractable");
  }
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const { kty } = jwk;
  const { alg, e, n } = jwk;
  const { crv, x, y } = jwk;
  return { kty, alg, e, n, crv, x, y, key_ops: [CryptoKeyUsage.Verify] };
}
__name(exportPublicJwkFrom, "exportPublicJwkFrom");
function getKeyAlgorithm(name) {
  switch (name) {
    case "HS256":
      return {
        name: "HMAC",
        hash: {
          name: "SHA-256"
        }
      };
    case "HS384":
      return {
        name: "HMAC",
        hash: {
          name: "SHA-384"
        }
      };
    case "HS512":
      return {
        name: "HMAC",
        hash: {
          name: "SHA-512"
        }
      };
    case "RS256":
      return {
        name: "RSASSA-PKCS1-v1_5",
        hash: {
          name: "SHA-256"
        }
      };
    case "RS384":
      return {
        name: "RSASSA-PKCS1-v1_5",
        hash: {
          name: "SHA-384"
        }
      };
    case "RS512":
      return {
        name: "RSASSA-PKCS1-v1_5",
        hash: {
          name: "SHA-512"
        }
      };
    case "PS256":
      return {
        name: "RSA-PSS",
        hash: {
          name: "SHA-256"
        },
        saltLength: 32
        // 256 >> 3
      };
    case "PS384":
      return {
        name: "RSA-PSS",
        hash: {
          name: "SHA-384"
        },
        saltLength: 48
        // 384 >> 3
      };
    case "PS512":
      return {
        name: "RSA-PSS",
        hash: {
          name: "SHA-512"
        },
        saltLength: 64
        // 512 >> 3,
      };
    case "ES256":
      return {
        name: "ECDSA",
        hash: {
          name: "SHA-256"
        },
        namedCurve: "P-256"
      };
    case "ES384":
      return {
        name: "ECDSA",
        hash: {
          name: "SHA-384"
        },
        namedCurve: "P-384"
      };
    case "ES512":
      return {
        name: "ECDSA",
        hash: {
          name: "SHA-512"
        },
        namedCurve: "P-521"
      };
    case "EdDSA":
      return {
        name: "Ed25519",
        namedCurve: "Ed25519"
      };
    default:
      throw new JwtAlgorithmNotImplemented(name);
  }
}
__name(getKeyAlgorithm, "getKeyAlgorithm");
function isCryptoKey(key) {
  const runtime = getRuntimeKey();
  if (runtime === "node" && !!crypto.webcrypto) {
    return key instanceof crypto.webcrypto.CryptoKey;
  }
  return key instanceof CryptoKey;
}
__name(isCryptoKey, "isCryptoKey");

// node_modules/hono/dist/utils/jwt/jwt.js
var encodeJwtPart = /* @__PURE__ */ __name((part) => encodeBase64Url(utf8Encoder.encode(JSON.stringify(part)).buffer).replace(/=/g, ""), "encodeJwtPart");
var encodeSignaturePart = /* @__PURE__ */ __name((buf) => encodeBase64Url(buf).replace(/=/g, ""), "encodeSignaturePart");
var decodeJwtPart = /* @__PURE__ */ __name((part) => JSON.parse(utf8Decoder.decode(decodeBase64Url(part))), "decodeJwtPart");
function isTokenHeader(obj) {
  if (typeof obj === "object" && obj !== null) {
    const objWithAlg = obj;
    return "alg" in objWithAlg && Object.values(AlgorithmTypes).includes(objWithAlg.alg) && (!("typ" in objWithAlg) || objWithAlg.typ === "JWT");
  }
  return false;
}
__name(isTokenHeader, "isTokenHeader");
var sign = /* @__PURE__ */ __name(async (payload, privateKey, alg = "HS256") => {
  const encodedPayload = encodeJwtPart(payload);
  let encodedHeader;
  if (typeof privateKey === "object" && "alg" in privateKey) {
    alg = privateKey.alg;
    encodedHeader = encodeJwtPart({ alg, typ: "JWT", kid: privateKey.kid });
  } else {
    encodedHeader = encodeJwtPart({ alg, typ: "JWT" });
  }
  const partialToken = `${encodedHeader}.${encodedPayload}`;
  const signaturePart = await signing(privateKey, alg, utf8Encoder.encode(partialToken));
  const signature = encodeSignaturePart(signaturePart);
  return `${partialToken}.${signature}`;
}, "sign");
var verify = /* @__PURE__ */ __name(async (token, publicKey, algOrOptions) => {
  if (!algOrOptions) {
    throw new JwtAlgorithmRequired();
  }
  const {
    alg,
    iss,
    nbf = true,
    exp = true,
    iat = true,
    aud
  } = typeof algOrOptions === "string" ? { alg: algOrOptions } : algOrOptions;
  if (!alg) {
    throw new JwtAlgorithmRequired();
  }
  const tokenParts = token.split(".");
  if (tokenParts.length !== 3) {
    throw new JwtTokenInvalid(token);
  }
  const { header, payload } = decode(token);
  if (!isTokenHeader(header)) {
    throw new JwtHeaderInvalid(header);
  }
  if (header.alg !== alg) {
    throw new JwtAlgorithmMismatch(alg, header.alg);
  }
  const now = Math.floor(Date.now() / 1e3);
  if (nbf && payload.nbf !== void 0) {
    if (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf > now) {
      throw new JwtTokenNotBefore(token);
    }
  }
  if (exp && payload.exp !== void 0) {
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= now) {
      throw new JwtTokenExpired(token);
    }
  }
  if (iat && payload.iat !== void 0) {
    if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat) || now < payload.iat) {
      throw new JwtTokenIssuedAt(now, payload.iat);
    }
  }
  if (iss) {
    if (!payload.iss) {
      throw new JwtTokenIssuer(iss, null);
    }
    if (typeof iss === "string" && payload.iss !== iss) {
      throw new JwtTokenIssuer(iss, payload.iss);
    }
    if (iss instanceof RegExp && !iss.test(payload.iss)) {
      throw new JwtTokenIssuer(iss, payload.iss);
    }
  }
  if (aud) {
    if (!payload.aud) {
      throw new JwtPayloadRequiresAud(payload);
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const matched = audiences.some(
      (payloadAud) => aud instanceof RegExp ? aud.test(payloadAud) : typeof aud === "string" ? payloadAud === aud : Array.isArray(aud) && aud.includes(payloadAud)
    );
    if (!matched) {
      throw new JwtTokenAudience(aud, payload.aud);
    }
  }
  const headerPayload = token.substring(0, token.lastIndexOf("."));
  const verified = await verifying(
    publicKey,
    alg,
    decodeBase64Url(tokenParts[2]),
    utf8Encoder.encode(headerPayload)
  );
  if (!verified) {
    throw new JwtTokenSignatureMismatched(token);
  }
  return payload;
}, "verify");
var symmetricAlgorithms = [
  AlgorithmTypes.HS256,
  AlgorithmTypes.HS384,
  AlgorithmTypes.HS512
];
var verifyWithJwks = /* @__PURE__ */ __name(async (token, options, init) => {
  const verifyOpts = options.verification || {};
  const header = decodeHeader(token);
  if (!isTokenHeader(header)) {
    throw new JwtHeaderInvalid(header);
  }
  if (!header.kid) {
    throw new JwtHeaderRequiresKid(header);
  }
  if (symmetricAlgorithms.includes(header.alg)) {
    throw new JwtSymmetricAlgorithmNotAllowed(header.alg);
  }
  if (!options.allowedAlgorithms.includes(header.alg)) {
    throw new JwtAlgorithmNotAllowed(header.alg, options.allowedAlgorithms);
  }
  let verifyKeys = options.keys ? [...options.keys] : void 0;
  if (options.jwks_uri) {
    const response = await fetch(options.jwks_uri, init);
    if (!response.ok) {
      throw new Error(`failed to fetch JWKS from ${options.jwks_uri}`);
    }
    const data = await response.json();
    if (!data.keys) {
      throw new Error('invalid JWKS response. "keys" field is missing');
    }
    if (!Array.isArray(data.keys)) {
      throw new Error('invalid JWKS response. "keys" field is not an array');
    }
    verifyKeys ??= [];
    verifyKeys.push(...data.keys);
  } else if (!verifyKeys) {
    throw new Error('verifyWithJwks requires options for either "keys" or "jwks_uri" or both');
  }
  const matchingKey = verifyKeys.find((key) => key.kid === header.kid);
  if (!matchingKey) {
    throw new JwtTokenInvalid(token);
  }
  if (matchingKey.alg && matchingKey.alg !== header.alg) {
    throw new JwtAlgorithmMismatch(matchingKey.alg, header.alg);
  }
  return await verify(token, matchingKey, {
    alg: header.alg,
    ...verifyOpts
  });
}, "verifyWithJwks");
var decode = /* @__PURE__ */ __name((token) => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new JwtTokenInvalid(token);
  }
  try {
    const header = decodeJwtPart(parts[0]);
    const payload = decodeJwtPart(parts[1]);
    return {
      header,
      payload
    };
  } catch {
    throw new JwtTokenInvalid(token);
  }
}, "decode");
var decodeHeader = /* @__PURE__ */ __name((token) => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new JwtTokenInvalid(token);
  }
  try {
    return decodeJwtPart(parts[0]);
  } catch {
    throw new JwtTokenInvalid(token);
  }
}, "decodeHeader");

// node_modules/hono/dist/utils/jwt/index.js
var Jwt = { sign, verify, decode, verifyWithJwks };

// node_modules/hono/dist/middleware/jwt/jwt.js
var verifyWithJwks2 = Jwt.verifyWithJwks;
var verify2 = Jwt.verify;
var decode2 = Jwt.decode;
var sign2 = Jwt.sign;

// src/routes/auth.ts
var bcrypt = __toESM(require_bcrypt());

// src/db.ts
function uuidv4() {
  return crypto.randomUUID();
}
__name(uuidv4, "uuidv4");

// src/routes/auth.ts
var auth = new Hono2();
auth.post("/login", async (c) => {
  const body = await c.req.json();
  const { email, password } = body;
  const user = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.password_hash, u.full_name,
           (SELECT GROUP_CONCAT(p.code) 
            FROM user_roles ur
            JOIN role_permissions rp ON rp.role_id = ur.role_id
            JOIN permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = u.id) as permissions
    FROM users u
    WHERE u.email = ? AND u.is_active = 1
  `).bind(email).first();
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ message: "Invalid credentials" }, 401);
  }
  const permissions = user.permissions ? user.permissions.split(",") : [];
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.full_name,
    permissions
  };
  const accessToken = await sign2({ ...payload, exp: Math.floor(Date.now() / 1e3) + 15 * 60 }, c.env.JWT_ACCESS_SECRET, "HS256");
  const refreshToken = await sign2({ sub: user.id, type: "refresh", exp: Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60 }, c.env.JWT_REFRESH_SECRET, "HS256");
  const tokenHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(refreshToken)).then((b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join(""));
  await c.env.DB.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, datetime('now', '+7 days'))
  `).bind(uuidv4(), user.id, tokenHash).run();
  await c.env.DB.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id).run();
  return c.json({
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, fullName: user.full_name, permissions }
  });
});
auth.post("/refresh", async (c) => {
  const { refreshToken } = await c.req.json();
  let decoded;
  try {
    decoded = await verify2(refreshToken, c.env.JWT_REFRESH_SECRET, "HS256");
  } catch (error) {
    return c.json({ message: "Invalid or expired token" }, 401);
  }
  if (decoded.type !== "refresh") {
    return c.json({ message: "Invalid token type" }, 401);
  }
  const tokenHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(refreshToken)).then((b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join(""));
  const result = await c.env.DB.prepare(`
    DELETE FROM refresh_tokens 
    WHERE user_id = ? AND token_hash = ? AND expires_at > CURRENT_TIMESTAMP
    RETURNING id
  `).bind(decoded.sub, tokenHash).run();
  if (!result.results || result.results.length === 0) {
    await c.env.DB.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").bind(decoded.sub).run();
    return c.json({ message: "Refresh token revoked" }, 401);
  }
  const user = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.full_name,
           (SELECT GROUP_CONCAT(p.code) 
            FROM user_roles ur
            JOIN role_permissions rp ON rp.role_id = ur.role_id
            JOIN permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = u.id) as permissions
    FROM users u
    WHERE u.id = ? AND u.is_active = 1
  `).bind(decoded.sub).first();
  if (!user) return c.json({ message: "User not found" }, 401);
  const permissions = user.permissions ? user.permissions.split(",") : [];
  const accessToken = await sign2({
    sub: user.id,
    email: user.email,
    name: user.full_name,
    permissions,
    exp: Math.floor(Date.now() / 1e3) + 15 * 60
  }, c.env.JWT_ACCESS_SECRET, "HS256");
  const newRefreshToken = await sign2({
    sub: user.id,
    type: "refresh",
    exp: Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60
  }, c.env.JWT_REFRESH_SECRET, "HS256");
  const newTokenHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(newRefreshToken)).then((b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join(""));
  await c.env.DB.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, datetime('now', '+7 days'))
  `).bind(uuidv4(), user.id, newTokenHash).run();
  return c.json({
    accessToken,
    refreshToken: newRefreshToken,
    user: { id: user.id, email: user.email, fullName: user.full_name, permissions }
  });
});
var auth_default = auth;

// src/middleware/auth.ts
var authMiddleware = /* @__PURE__ */ __name(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = await verify2(token, c.env.JWT_ACCESS_SECRET, "HS256");
    c.set("jwtPayload", payload);
    await next();
  } catch (error) {
    return c.json({ message: "Invalid or expired token" }, 401);
  }
}, "authMiddleware");
var requirePermissions = /* @__PURE__ */ __name((requiredPermissions) => {
  return async (c, next) => {
    const payload = c.get("jwtPayload");
    if (!payload) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    if (requiredPermissions.length === 0) {
      return next();
    }
    const hasAll = requiredPermissions.every((p) => payload.permissions.includes(p));
    if (!hasAll) {
      return c.json({ message: "Forbidden" }, 403);
    }
    await next();
  };
}, "requirePermissions");

// src/services/audit.ts
function createAuditLogStmt(c, action, entityType, entityId, oldValue, newValue) {
  const id = uuidv4();
  let actorUserId = null;
  try {
    const jwtPayload = c.get("jwtPayload");
    if (jwtPayload && jwtPayload.sub) actorUserId = jwtPayload.sub;
  } catch (_) {
  }
  let ipAddress = null;
  let userAgent = null;
  try {
    ipAddress = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || c.req.header("x-real-ip") || null;
    userAgent = c.req.header("User-Agent") || null;
  } catch (_) {
  }
  const oldValStr = oldValue !== void 0 && oldValue !== null ? typeof oldValue === "object" ? JSON.stringify(oldValue) : String(oldValue) : null;
  const newValStr = newValue !== void 0 && newValue !== null ? typeof newValue === "object" ? JSON.stringify(newValue) : String(newValue) : null;
  return c.env.DB.prepare(`
    INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, actorUserId, action, entityType, entityId || null, oldValStr, newValStr, ipAddress, userAgent);
}
__name(createAuditLogStmt, "createAuditLogStmt");
async function logAudit(c, action, entityType, entityId, oldValue, newValue) {
  try {
    const stmt = createAuditLogStmt(c, action, entityType, entityId, oldValue, newValue);
    await stmt.run();
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}
__name(logAudit, "logAudit");

// src/routes/products.ts
var products = new Hono2();
products.use("/*", authMiddleware);
products.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT p.*, c.name as category_name, b.name as brand_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    ORDER BY p.name ASC
    LIMIT 100
  `).all();
  return c.json(results);
});
products.post("/", requirePermissions(["manage_inventory"]), async (c) => {
  const body = await c.req.json();
  if (!body.sku || !body.sku.trim()) return c.json({ message: "SKU is required." }, 400);
  if (!body.name || !body.name.trim()) return c.json({ message: "Product name is required." }, 400);
  const cost = Number(body.costPrice || 0);
  const sell = Number(body.sellingPrice || 0);
  if (cost < 0) return c.json({ message: "Cost price cannot be negative." }, 400);
  if (sell < 0) return c.json({ message: "Selling price cannot be negative." }, 400);
  if (cost > sell) return c.json({ message: "Cost price cannot be greater than selling price." }, 400);
  const existingSku = await c.env.DB.prepare("SELECT id FROM products WHERE sku = ?").bind(body.sku.trim()).first();
  if (existingSku) return c.json({ message: "A product with this SKU already exists." }, 409);
  if (body.barcode) {
    const existingBarcode = await c.env.DB.prepare("SELECT id FROM products WHERE barcode = ?").bind(body.barcode).first();
    if (existingBarcode) return c.json({ message: "A product with this barcode already exists." }, 409);
  }
  if (body.categoryId) {
    const cat = await c.env.DB.prepare("SELECT id FROM categories WHERE id = ?").bind(body.categoryId).first();
    if (!cat) return c.json({ message: "Category does not exist." }, 400);
  }
  if (body.brandId) {
    const brand = await c.env.DB.prepare("SELECT id FROM brands WHERE id = ?").bind(body.brandId).first();
    if (!brand) return c.json({ message: "Brand does not exist." }, 400);
  }
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO products (id, sku, name, description, category_id, brand_id, cost_price, selling_price, reorder_level, barcode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.sku.trim(),
    body.name.trim(),
    body.description || null,
    body.categoryId || null,
    body.brandId || null,
    cost,
    sell,
    body.reorderLevel || 5,
    body.barcode || null
  ).run();
  const { results } = await c.env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).all();
  await logAudit(c, "PRODUCT_CREATE", "products", id, null, body);
  return c.json(results[0], 201);
});
products.get("/categories", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM categories ORDER BY name ASC").all();
  return c.json(results);
});
products.post("/categories", requirePermissions(["manage_inventory"]), async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.name.trim()) return c.json({ message: "Category name is required." }, 400);
  const existing = await c.env.DB.prepare("SELECT id FROM categories WHERE name = ?").bind(body.name.trim()).first();
  if (existing) return c.json({ message: "A category with this name already exists." }, 409);
  const id = uuidv4();
  await c.env.DB.prepare("INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)").bind(id, body.name.trim(), body.parentId || null).run();
  const { results } = await c.env.DB.prepare("SELECT * FROM categories WHERE id = ?").bind(id).all();
  await logAudit(c, "CATEGORY_CREATE", "categories", id, null, body);
  return c.json(results[0], 201);
});
products.get("/brands", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM brands ORDER BY name ASC").all();
  return c.json(results);
});
products.delete("/categories/:id", requirePermissions(["manage_inventory"]), async (c) => {
  const id = c.req.param("id");
  const refs = await c.env.DB.prepare("SELECT id FROM products WHERE category_id = ? LIMIT 1").bind(id).first();
  if (refs) return c.json({ message: "Cannot delete: products are assigned to this category." }, 400);
  const cat = await c.env.DB.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first();
  if (!cat) return c.json({ message: "Category not found" }, 404);
  await c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
  await logAudit(c, "CATEGORY_DELETE", "categories", id, cat, null);
  return c.json({ success: true });
});
products.get("/:id", async (c) => {
  const id = c.req.param("id");
  const product = await c.env.DB.prepare(`
    SELECT p.*, c.name as category_name, b.name as brand_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.id = ?
  `).bind(id).first();
  if (!product) return c.json({ message: "Product not found" }, 404);
  return c.json(product);
});
products.delete("/:id", requirePermissions(["manage_inventory"]), async (c) => {
  const id = c.req.param("id");
  const inOrders = await c.env.DB.prepare("SELECT id FROM sales_order_lines WHERE product_id = ? LIMIT 1").bind(id).first();
  if (inOrders) return c.json({ message: "Cannot delete: product is referenced in sales orders." }, 400);
  const inPO = await c.env.DB.prepare("SELECT id FROM purchase_order_lines WHERE product_id = ? LIMIT 1").bind(id).first();
  if (inPO) return c.json({ message: "Cannot delete: product is referenced in purchase orders." }, 400);
  const inStock = await c.env.DB.prepare("SELECT id FROM inventory_stock WHERE product_id = ? AND quantity_on_hand > 0 LIMIT 1").bind(id).first();
  if (inStock) return c.json({ message: "Cannot delete: product has active inventory stock." }, 400);
  const prod = await c.env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first();
  if (!prod) return c.json({ message: "Product not found" }, 404);
  await c.env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
  await logAudit(c, "PRODUCT_DELETE", "products", id, prod, null);
  return c.json({ success: true });
});
var products_default = products;

// src/routes/inventory.ts
var inventory = new Hono2();
inventory.use("/*", authMiddleware);
inventory.get("/stock", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT s.id, p.name, p.sku, p.barcode, s.product_id, s.owner_type, s.quantity_on_hand, s.quantity_reserved,
           w.name AS warehouse, b.name AS branch, l.aisle, l.rack, l.shelf, l.bin
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN warehouse_locations l ON l.id = s.warehouse_location_id
    ORDER BY p.name
    LIMIT 100
  `).all();
  return c.json(results);
});
inventory.get("/transactions", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT t.*, p.name, p.sku, p.barcode,
           sw.name AS source_warehouse, sb.name AS source_branch,
           dw.name AS destination_warehouse, db.name AS destination_branch,
           l.aisle, l.rack, l.shelf, l.bin,
           u.full_name AS user_name
    FROM inventory_transactions t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN warehouses sw ON sw.id = t.source_warehouse_id
    LEFT JOIN branches sb ON sb.id = t.source_branch_id
    LEFT JOIN warehouses dw ON dw.id = t.destination_warehouse_id
    LEFT JOIN branches db ON db.id = t.destination_branch_id
    LEFT JOIN warehouse_locations l ON l.id = t.destination_location_id
    LEFT JOIN users u ON u.id = t.created_by
    ORDER BY t.created_at DESC
    LIMIT 200
  `).all();
  return c.json(results);
});
inventory.post("/adjust", requirePermissions(["manage_inventory"]), async (c) => {
  const body = await c.req.json();
  const userId = c.get("jwtPayload").sub;
  if (!body.productId) return c.json({ message: "Product is required." }, 400);
  if (!body.quantity || !Number.isInteger(body.quantity) || body.quantity <= 0) {
    return c.json({ message: "Quantity must be a positive integer." }, 400);
  }
  if (!body.direction || !["INCREASE", "DECREASE"].includes(body.direction)) {
    return c.json({ message: "Direction must be INCREASE or DECREASE." }, 400);
  }
  const product = await c.env.DB.prepare("SELECT id, name FROM products WHERE id = ?").bind(body.productId).first();
  if (!product) return c.json({ message: "Product does not exist." }, 400);
  const ownerType = body.warehouseId ? "WAREHOUSE" : "BRANCH";
  if (ownerType === "WAREHOUSE" && !body.warehouseId) return c.json({ message: "Warehouse is required." }, 400);
  if (ownerType === "BRANCH" && !body.branchId) return c.json({ message: "Branch is required." }, 400);
  if (body.warehouseId) {
    const wh = await c.env.DB.prepare("SELECT id FROM warehouses WHERE id = ?").bind(body.warehouseId).first();
    if (!wh) return c.json({ message: "Warehouse does not exist." }, 400);
  }
  if (body.branchId) {
    const br = await c.env.DB.prepare("SELECT id FROM branches WHERE id = ?").bind(body.branchId).first();
    if (!br) return c.json({ message: "Branch does not exist." }, 400);
  }
  const delta = body.direction === "INCREASE" ? body.quantity : -body.quantity;
  const transactionType = delta > 0 ? "ADJUSTMENT_POSITIVE" : "ADJUSTMENT_NEGATIVE";
  const existingStock = await c.env.DB.prepare(`
    SELECT id, quantity_on_hand FROM inventory_stock
    WHERE product_id = ? AND owner_type = ? 
      AND (warehouse_id = ? OR (warehouse_id IS NULL AND ? IS NULL))
      AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))
      AND (warehouse_location_id = ? OR (warehouse_location_id IS NULL AND ? IS NULL))
  `).bind(
    body.productId,
    ownerType,
    body.warehouseId || null,
    body.warehouseId || null,
    body.branchId || null,
    body.branchId || null,
    body.warehouseLocationId || null,
    body.warehouseLocationId || null
  ).first();
  if (body.direction === "DECREASE") {
    const currentQty = existingStock?.quantity_on_hand || 0;
    if (currentQty < body.quantity) {
      return c.json({
        message: `Insufficient stock. Current quantity: ${currentQty}, requested decrease: ${body.quantity}.`
      }, 400);
    }
  }
  const stmts = [];
  if (existingStock) {
    stmts.push(c.env.DB.prepare(`
      UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(delta, existingStock.id));
  } else {
    if (delta < 0) {
      return c.json({ message: "Cannot decrease stock that does not exist." }, 400);
    }
    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, branch_id, warehouse_location_id, quantity_on_hand)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(uuidv4(), body.productId, ownerType, body.warehouseId || null, body.branchId || null, body.warehouseLocationId || null, delta));
  }
  const txId = uuidv4();
  stmts.push(c.env.DB.prepare(`
    INSERT INTO inventory_transactions
    (id, product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_branch_id, destination_location_id, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(txId, body.productId, transactionType, delta, ownerType, body.warehouseId || null, body.branchId || null, body.warehouseLocationId || null, body.notes || null, userId));
  stmts.push(createAuditLogStmt(c, "INVENTORY_ADJUST", "inventory_stock", txId, null, { productId: body.productId, quantity: body.quantity, direction: body.direction, ownerType, warehouseId: body.warehouseId, branchId: body.branchId, notes: body.notes }));
  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare("SELECT * FROM inventory_transactions WHERE id = ?").bind(txId).all();
  return c.json(results[0], 201);
});
var inventory_default = inventory;

// src/routes/warehouses.ts
var warehouses = new Hono2();
warehouses.use("/*", authMiddleware);
warehouses.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM warehouses ORDER BY name").all();
  return c.json(results);
});
warehouses.post("/", requirePermissions(["manage_inventory"]), async (c) => {
  const body = await c.req.json();
  if (!body.code || !body.code.trim()) return c.json({ message: "Warehouse code is required." }, 400);
  if (!body.name || !body.name.trim()) return c.json({ message: "Warehouse name is required." }, 400);
  if (!body.city || !body.city.trim()) return c.json({ message: "City is required." }, 400);
  const existing = await c.env.DB.prepare("SELECT id FROM warehouses WHERE code = ?").bind(body.code.trim()).first();
  if (existing) return c.json({ message: "A warehouse with this code already exists." }, 409);
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO warehouses (id, code, name, city, address, phone)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.code.trim(), body.name.trim(), body.city.trim(), body.address || null, body.phone || null).run();
  const { results } = await c.env.DB.prepare("SELECT * FROM warehouses WHERE id = ?").bind(id).all();
  await logAudit(c, "WAREHOUSE_CREATE", "warehouses", id, null, body);
  return c.json(results[0], 201);
});
warehouses.get("/:id/locations", async (c) => {
  const id = c.req.param("id");
  const { results } = await c.env.DB.prepare("SELECT * FROM warehouse_locations WHERE warehouse_id = ? ORDER BY aisle, rack, shelf, bin").bind(id).all();
  return c.json(results);
});
warehouses.post("/:id/locations", requirePermissions(["manage_inventory"]), async (c) => {
  const warehouseId = c.req.param("id");
  const body = await c.req.json();
  if (!body.aisle || !body.aisle.trim()) return c.json({ message: "Aisle is required." }, 400);
  if (!body.rack || !body.rack.trim()) return c.json({ message: "Rack is required." }, 400);
  if (!body.shelf || !body.shelf.trim()) return c.json({ message: "Shelf is required." }, 400);
  if (!body.bin || !body.bin.trim()) return c.json({ message: "Bin is required." }, 400);
  if (!body.barcode || !body.barcode.trim()) return c.json({ message: "Barcode is required." }, 400);
  const wh = await c.env.DB.prepare("SELECT id FROM warehouses WHERE id = ?").bind(warehouseId).first();
  if (!wh) return c.json({ message: "Warehouse not found." }, 404);
  const existingBarcode = await c.env.DB.prepare("SELECT id FROM warehouse_locations WHERE barcode = ?").bind(body.barcode.trim()).first();
  if (existingBarcode) return c.json({ message: "A location with this barcode already exists." }, 409);
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO warehouse_locations (id, warehouse_id, aisle, rack, shelf, bin, barcode)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, warehouseId, body.aisle.trim(), body.rack.trim(), body.shelf.trim(), body.bin.trim(), body.barcode.trim()).run();
  const { results } = await c.env.DB.prepare("SELECT * FROM warehouse_locations WHERE id = ?").bind(id).all();
  await logAudit(c, "WAREHOUSE_LOCATION_CREATE", "warehouses", warehouseId, null, { locationId: id, ...body });
  return c.json(results[0], 201);
});
warehouses.get("/:id/inventory", async (c) => {
  const id = c.req.param("id");
  const { results } = await c.env.DB.prepare(`
    SELECT i.*, p.name, p.sku, p.barcode
    FROM inventory_stock i
    JOIN products p ON p.id = i.product_id
    WHERE i.warehouse_id = ? AND i.owner_type = 'WAREHOUSE'
    ORDER BY p.name ASC
  `).bind(id).all();
  return c.json(results);
});
warehouses.get("/:id/summary", async (c) => {
  const id = c.req.param("id");
  const stockSummary = await c.env.DB.prepare(`
    SELECT 
      COUNT(DISTINCT i.product_id) as total_products,
      COALESCE(SUM(i.quantity_on_hand), 0) as total_units,
      COALESCE(SUM(i.quantity_on_hand * p.cost_price), 0) as inventory_value
    FROM inventory_stock i
    JOIN products p ON p.id = i.product_id
    WHERE i.warehouse_id = ? AND i.owner_type = 'WAREHOUSE'
  `).bind(id).first();
  const locationCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM warehouse_locations WHERE warehouse_id = ?"
  ).bind(id).first();
  const receiptsCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM goods_receipts WHERE warehouse_id = ?"
  ).bind(id).first();
  const transfersIn = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM transfers WHERE destination_warehouse_id = ? AND status = 'COMPLETED'"
  ).bind(id).first();
  const transfersOut = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM transfers WHERE source_warehouse_id = ? AND status = 'COMPLETED'"
  ).bind(id).first();
  return c.json({
    total_products: stockSummary?.total_products || 0,
    total_units: stockSummary?.total_units || 0,
    inventory_value: stockSummary?.inventory_value || 0,
    location_count: locationCount?.count || 0,
    receipts_count: receiptsCount?.count || 0,
    transfers_in: transfersIn?.count || 0,
    transfers_out: transfersOut?.count || 0
  });
});
warehouses.get("/:id", async (c) => {
  const id = c.req.param("id");
  const wh = await c.env.DB.prepare("SELECT * FROM warehouses WHERE id = ?").bind(id).first();
  if (!wh) return c.json({ message: "Warehouse not found" }, 404);
  return c.json(wh);
});
var warehouses_default = warehouses;

// src/routes/branches.ts
var branches = new Hono2();
branches.use("/*", authMiddleware);
branches.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM branches ORDER BY name").all();
  return c.json(results);
});
branches.post("/", requirePermissions(["manage_inventory"]), async (c) => {
  const body = await c.req.json();
  if (!body.code || !body.code.trim()) return c.json({ message: "Branch code is required." }, 400);
  if (!body.name || !body.name.trim()) return c.json({ message: "Branch name is required." }, 400);
  if (!body.city || !body.city.trim()) return c.json({ message: "City is required." }, 400);
  const existing = await c.env.DB.prepare("SELECT id FROM branches WHERE code = ?").bind(body.code.trim()).first();
  if (existing) return c.json({ message: "A branch with this code already exists." }, 409);
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO branches (id, code, name, city, address, phone)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.code.trim(), body.name.trim(), body.city.trim(), body.address || null, body.phone || null).run();
  const { results } = await c.env.DB.prepare("SELECT * FROM branches WHERE id = ?").bind(id).all();
  await logAudit(c, "BRANCH_CREATE", "branches", id, null, body);
  return c.json(results[0], 201);
});
branches.get("/:id", async (c) => {
  const id = c.req.param("id");
  const branch = await c.env.DB.prepare("SELECT * FROM branches WHERE id = ?").bind(id).first();
  if (!branch) return c.json({ message: "Branch not found" }, 404);
  return c.json(branch);
});
branches.get("/:id/performance", async (c) => {
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(`
    SELECT 
      b.id, b.code, b.name,
      COUNT(DISTINCT so.id) as order_count,
      COALESCE(SUM(i.total_amount), 0) as invoiced_amount,
      COALESCE(SUM(sol.quantity), 0) as units_sold
    FROM branches b
    LEFT JOIN sales_orders so ON so.branch_id = b.id
    LEFT JOIN invoices i ON i.sales_order_id = so.id AND i.status = 'PAID'
    LEFT JOIN sales_order_lines sol ON sol.sales_order_id = so.id
    WHERE b.id = ?
    GROUP BY b.id, b.code, b.name
  `).bind(id).first();
  if (!result) return c.json({ message: "Branch not found" }, 404);
  return c.json(result);
});
branches.get("/:id/inventory", async (c) => {
  const id = c.req.param("id");
  const { results } = await c.env.DB.prepare(`
    SELECT p.name, p.sku, p.barcode,
           s.quantity_on_hand, s.quantity_reserved,
           (s.quantity_on_hand - s.quantity_reserved) as available_quantity
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    WHERE s.branch_id = ? AND s.owner_type = 'BRANCH'
    ORDER BY p.name ASC
  `).bind(id).all();
  return c.json(results);
});
var branches_default = branches;

// src/routes/transfers.ts
var transfers = new Hono2();
transfers.use("/*", authMiddleware);
transfers.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT
      t.*,
      COALESCE(sw.name, sb.name, 'Unknown') AS source_name,
      COALESCE(dw.name, db.name, 'Unknown') AS destination_name,
      (SELECT COUNT(*) FROM transfer_lines tl WHERE tl.transfer_id = t.id) AS line_count
    FROM transfers t
    LEFT JOIN warehouses sw ON sw.id = t.source_warehouse_id
    LEFT JOIN branches   sb ON sb.id = t.source_branch_id
    LEFT JOIN warehouses dw ON dw.id = t.destination_warehouse_id
    LEFT JOIN branches   db ON db.id = t.destination_branch_id
    ORDER BY t.requested_at DESC
    LIMIT 100
  `).all();
  return c.json(results);
});
transfers.get("/:id", async (c) => {
  const id = c.req.param("id");
  const { results: transfers2 } = await c.env.DB.prepare("SELECT * FROM transfers WHERE id = ?").bind(id).all();
  if (!transfers2.length) return c.json({ message: "Not found" }, 404);
  const transfer = transfers2[0];
  const { results: lines } = await c.env.DB.prepare(`
    SELECT tl.*, p.name as product_name, p.sku as product_sku 
    FROM transfer_lines tl
    JOIN products p ON p.id = tl.product_id
    WHERE tl.transfer_id = ?
  `).bind(id).all();
  return c.json({ ...transfer, lines });
});
transfers.post("/", requirePermissions(["manage_transfers"]), async (c) => {
  const body = await c.req.json();
  const userId = c.get("jwtPayload").sub;
  const validOwnerTypes = ["WAREHOUSE", "BRANCH"];
  if (!body.sourceOwnerType || !validOwnerTypes.includes(body.sourceOwnerType)) {
    return c.json({ message: "Invalid or missing sourceOwnerType. Must be WAREHOUSE or BRANCH." }, 400);
  }
  if (!body.destinationOwnerType || !validOwnerTypes.includes(body.destinationOwnerType)) {
    return c.json({ message: "Invalid or missing destinationOwnerType. Must be WAREHOUSE or BRANCH." }, 400);
  }
  const sourceId = body.sourceOwnerType === "WAREHOUSE" ? body.sourceWarehouseId : body.sourceBranchId;
  const destId = body.destinationOwnerType === "WAREHOUSE" ? body.destinationWarehouseId : body.destinationBranchId;
  if (!sourceId) {
    return c.json({ message: `A source ${body.sourceOwnerType.toLowerCase()} must be selected.` }, 400);
  }
  if (!destId) {
    return c.json({ message: `A destination ${body.destinationOwnerType.toLowerCase()} must be selected.` }, 400);
  }
  if (body.sourceOwnerType === body.destinationOwnerType && sourceId === destId) {
    return c.json({ message: "Source and destination cannot be the same location." }, 400);
  }
  if (body.sourceOwnerType === "WAREHOUSE") {
    const wh = await c.env.DB.prepare("SELECT id FROM warehouses WHERE id = ?").bind(sourceId).first();
    if (!wh) return c.json({ message: "Source warehouse does not exist." }, 400);
  } else {
    const br = await c.env.DB.prepare("SELECT id FROM branches WHERE id = ?").bind(sourceId).first();
    if (!br) return c.json({ message: "Source branch does not exist." }, 400);
  }
  if (body.destinationOwnerType === "WAREHOUSE") {
    const wh = await c.env.DB.prepare("SELECT id FROM warehouses WHERE id = ?").bind(destId).first();
    if (!wh) return c.json({ message: "Destination warehouse does not exist." }, 400);
  } else {
    const br = await c.env.DB.prepare("SELECT id FROM branches WHERE id = ?").bind(destId).first();
    if (!br) return c.json({ message: "Destination branch does not exist." }, 400);
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: "At least one line item is required." }, 400);
  }
  const seenProductIds = /* @__PURE__ */ new Set();
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) {
      return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    }
    if (!line.quantityRequested || !Number.isInteger(line.quantityRequested) || line.quantityRequested <= 0) {
      return c.json({ message: `Line ${i + 1}: quantityRequested must be a positive integer.` }, 400);
    }
    if (seenProductIds.has(line.productId)) {
      return c.json({ message: `Line ${i + 1}: duplicate product detected. Combine quantities into one line.` }, 400);
    }
    seenProductIds.add(line.productId);
    const product = await c.env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(line.productId).first();
    if (!product) {
      return c.json({ message: `Line ${i + 1}: product '${line.productId}' does not exist.` }, 400);
    }
  }
  const id = uuidv4();
  const transferNumber = `TR-${Date.now()}`;
  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO transfers (id, transfer_number, status, source_owner_type, source_warehouse_id, source_branch_id, destination_owner_type, destination_warehouse_id, destination_branch_id, requested_by, transfer_date)
    VALUES (?, ?, 'PENDING_APPROVAL', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, transferNumber, body.sourceOwnerType, body.sourceWarehouseId || null, body.sourceBranchId || null, body.destinationOwnerType, body.destinationWarehouseId || null, body.destinationBranchId || null, userId, body.transferDate || null));
  for (const line of body.lines) {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO transfer_lines (id, transfer_id, product_id, quantity_requested) VALUES (?, ?, ?, ?)
    `).bind(uuidv4(), id, line.productId, line.quantityRequested));
  }
  stmts.push(createAuditLogStmt(c, "TRANSFER_CREATE", "transfers", id, null, { transferNumber, sourceOwnerType: body.sourceOwnerType, destinationOwnerType: body.destinationOwnerType, lines: body.lines }));
  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare("SELECT * FROM transfers WHERE id = ?").bind(id).all();
  return c.json(results[0], 201);
});
transfers.post("/:id/approve", requirePermissions(["manage_transfers"]), async (c) => {
  const id = c.req.param("id");
  const userId = c.get("jwtPayload").sub;
  const cas = await c.env.DB.prepare(
    "UPDATE transfers SET status = 'PROCESSING' WHERE id = ? AND status = 'PENDING_APPROVAL'"
  ).bind(id).run();
  if (!cas.meta.changes || cas.meta.changes === 0) {
    const existing = await c.env.DB.prepare("SELECT status FROM transfers WHERE id = ?").bind(id).first();
    if (!existing) return c.json({ message: "Transfer not found." }, 404);
    if (existing.status === "COMPLETED") return c.json({ message: "This transfer has already been completed." }, 409);
    if (existing.status === "PROCESSING") return c.json({ message: "This transfer is currently being processed by another request." }, 409);
    return c.json({ message: `Transfer cannot be approved from status '${existing.status}'.` }, 400);
  }
  try {
    const transfer = await c.env.DB.prepare("SELECT * FROM transfers WHERE id = ?").bind(id).first();
    if (!transfer) {
      await c.env.DB.prepare("UPDATE transfers SET status = 'PENDING_APPROVAL' WHERE id = ?").bind(id).run();
      return c.json({ message: "Transfer not found after lock acquisition." }, 500);
    }
    if (transfer.transfer_date) {
      const transferDate = new Date(transfer.transfer_date);
      const today = /* @__PURE__ */ new Date();
      today.setHours(0, 0, 0, 0);
      transferDate.setHours(0, 0, 0, 0);
      if (transferDate > today) {
        await c.env.DB.prepare("UPDATE transfers SET status = 'PENDING_APPROVAL' WHERE id = ?").bind(id).run();
        return c.json({ message: `Cannot approve: transfer is scheduled for ${transfer.transfer_date.slice(0, 10)}, which is in the future.` }, 400);
      }
    }
    const { results: lines } = await c.env.DB.prepare(
      "SELECT * FROM transfer_lines WHERE transfer_id = ?"
    ).bind(id).all();
    if (!lines || lines.length === 0) {
      await c.env.DB.prepare("UPDATE transfers SET status = 'PENDING_APPROVAL' WHERE id = ?").bind(id).run();
      return c.json({ message: "Transfer has no line items." }, 400);
    }
    const insufficientLines = [];
    const stockInfoMap = /* @__PURE__ */ new Map();
    await Promise.all(
      lines.map(async (line) => {
        const [srcStock, dstStock] = await Promise.all([
          c.env.DB.prepare(`
            SELECT id, quantity_on_hand FROM inventory_stock
            WHERE product_id = ? AND owner_type = ?
              AND (warehouse_id = ? OR (warehouse_id IS NULL AND ? IS NULL))
              AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))
          `).bind(
            line.product_id,
            transfer.source_owner_type,
            transfer.source_warehouse_id || null,
            transfer.source_warehouse_id || null,
            transfer.source_branch_id || null,
            transfer.source_branch_id || null
          ).first(),
          c.env.DB.prepare(`
            SELECT id FROM inventory_stock
            WHERE product_id = ? AND owner_type = ?
              AND (warehouse_id = ? OR (warehouse_id IS NULL AND ? IS NULL))
              AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))
          `).bind(
            line.product_id,
            transfer.destination_owner_type,
            transfer.destination_warehouse_id || null,
            transfer.destination_warehouse_id || null,
            transfer.destination_branch_id || null,
            transfer.destination_branch_id || null
          ).first()
        ]);
        const srcQty = srcStock?.quantity_on_hand || 0;
        const reqQty = line.quantity_requested;
        if (srcQty < reqQty) {
          insufficientLines.push(
            `Product ${line.product_id}: requested ${reqQty}, available ${srcQty}`
          );
        }
        stockInfoMap.set(line.id, {
          sourceStockId: srcStock?.id || null,
          sourceQtyOnHand: srcQty,
          destStockId: dstStock?.id || null
        });
      })
    );
    if (insufficientLines.length > 0) {
      await c.env.DB.prepare("UPDATE transfers SET status = 'PENDING_APPROVAL' WHERE id = ?").bind(id).run();
      return c.json({
        message: "Insufficient stock to fulfill this transfer.",
        details: insufficientLines
      }, 400);
    }
    const stmts = [];
    for (const line of lines) {
      const qty = line.quantity_requested;
      const info = stockInfoMap.get(line.id);
      stmts.push(c.env.DB.prepare(`
        UPDATE inventory_stock
        SET quantity_on_hand = quantity_on_hand - ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND owner_type = ?
          AND (warehouse_id = ? OR (warehouse_id IS NULL AND ? IS NULL))
          AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))
      `).bind(
        qty,
        line.product_id,
        transfer.source_owner_type,
        transfer.source_warehouse_id || null,
        transfer.source_warehouse_id || null,
        transfer.source_branch_id || null,
        transfer.source_branch_id || null
      ));
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions
        (id, product_id, transaction_type, quantity,
         source_owner_type, source_warehouse_id, source_branch_id,
         destination_owner_type, destination_warehouse_id, destination_branch_id,
         reference_type, reference_id, created_by)
        VALUES (?, ?, 'TRANSFER_OUT', ?,  ?, ?, ?,  ?, ?, ?,  'TRANSFER', ?, ?)
      `).bind(
        uuidv4(),
        line.product_id,
        -qty,
        transfer.source_owner_type,
        transfer.source_warehouse_id || null,
        transfer.source_branch_id || null,
        transfer.destination_owner_type,
        transfer.destination_warehouse_id || null,
        transfer.destination_branch_id || null,
        id,
        userId
      ));
      if (info.destStockId) {
        stmts.push(c.env.DB.prepare(`
          UPDATE inventory_stock
          SET quantity_on_hand = quantity_on_hand + ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(qty, info.destStockId));
      } else {
        stmts.push(c.env.DB.prepare(`
          INSERT INTO inventory_stock
          (id, product_id, owner_type, warehouse_id, branch_id, quantity_on_hand)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          uuidv4(),
          line.product_id,
          transfer.destination_owner_type,
          transfer.destination_warehouse_id || null,
          transfer.destination_branch_id || null,
          qty
        ));
      }
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions
        (id, product_id, transaction_type, quantity,
         source_owner_type, source_warehouse_id, source_branch_id,
         destination_owner_type, destination_warehouse_id, destination_branch_id,
         reference_type, reference_id, created_by)
        VALUES (?, ?, 'TRANSFER_IN', ?,  ?, ?, ?,  ?, ?, ?,  'TRANSFER', ?, ?)
      `).bind(
        uuidv4(),
        line.product_id,
        qty,
        transfer.source_owner_type,
        transfer.source_warehouse_id || null,
        transfer.source_branch_id || null,
        transfer.destination_owner_type,
        transfer.destination_warehouse_id || null,
        transfer.destination_branch_id || null,
        id,
        userId
      ));
      stmts.push(c.env.DB.prepare(
        "UPDATE transfer_lines SET quantity_dispatched = ?, quantity_received = ? WHERE id = ?"
      ).bind(qty, qty, line.id));
    }
    stmts.push(c.env.DB.prepare(`
      UPDATE transfers
      SET status = 'COMPLETED',
          approved_by = ?, approved_at = CURRENT_TIMESTAMP,
          dispatched_by = ?, dispatched_at = CURRENT_TIMESTAMP,
          received_by = ?,  received_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(userId, userId, userId, id));
    stmts.push(createAuditLogStmt(c, "TRANSFER_APPROVE_COMPLETE", "transfers", id, { status: "PENDING_APPROVAL" }, { status: "COMPLETED" }));
    await c.env.DB.batch(stmts);
    const result = await c.env.DB.prepare("SELECT * FROM transfers WHERE id = ?").bind(id).first();
    return c.json(result);
  } catch (err) {
    try {
      await c.env.DB.prepare("UPDATE transfers SET status = 'PENDING_APPROVAL' WHERE id = ?").bind(id).run();
    } catch (_rollbackErr) {
    }
    console.error("Transfer approval failed:", err);
    return c.json({ message: "Transfer approval failed. The transfer has been rolled back to Pending.", error: err?.message }, 500);
  }
});
var transfers_default = transfers;

// src/routes/purchasing.ts
var purchasing = new Hono2();
purchasing.use("/*", authMiddleware);
purchasing.get("/suppliers", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, phone, email, address, is_active FROM suppliers ORDER BY name").all();
  return c.json(results);
});
purchasing.post("/suppliers", requirePermissions(["manage_purchasing"]), async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.name.trim()) {
    return c.json({ message: "Supplier name is required." }, 400);
  }
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO suppliers (id, name, contact_name, phone, email, address)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.name.trim(), body.contactName || null, body.phone || null, body.email || null, body.address || null).run();
  const { results } = await c.env.DB.prepare("SELECT * FROM suppliers WHERE id = ?").bind(id).all();
  await logAudit(c, "SUPPLIER_CREATE", "suppliers", id, null, body);
  return c.json(results[0], 201);
});
purchasing.get("/orders", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    ORDER BY po.created_at DESC
    LIMIT 100
  `).all();
  return c.json(results);
});
purchasing.get("/orders/:id", async (c) => {
  const id = c.req.param("id");
  const po = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).bind(id).first();
  if (!po) return c.json({ message: "PO not found" }, 404);
  const { results: lines } = await c.env.DB.prepare(`
    SELECT pol.*, pol.quantity AS quantity_ordered, p.name as product_name, p.sku as variant_sku,
      (SELECT COALESCE(SUM(quantity_received), 0) FROM goods_receipt_lines grl 
       JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id 
       WHERE gr.purchase_order_id = ? AND grl.product_id = pol.product_id) as quantity_received
    FROM purchase_order_lines pol
    JOIN products p ON p.id = pol.product_id
    WHERE pol.purchase_order_id = ?
  `).bind(id, id).all();
  const invoice = await c.env.DB.prepare(
    "SELECT * FROM purchase_invoices WHERE purchase_order_id = ?"
  ).bind(id).first().catch(() => null);
  return c.json({ ...po, lines, invoice: invoice || null });
});
purchasing.get("/orders/:id/print-invoice", async (c) => {
  const id = c.req.param("id");
  const po = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name, s.contact_name, s.phone AS supplier_phone, s.email AS supplier_email, s.address AS supplier_address,
           w.name AS warehouse_name, w.address AS warehouse_address
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN warehouses w ON w.id = po.warehouse_id
    WHERE po.id = ?
  `).bind(id).first();
  if (!po) return c.json({ message: "PO not found" }, 404);
  const { results: lines } = await c.env.DB.prepare(`
    SELECT pol.*, pol.quantity AS quantity_ordered, p.name as product_name, p.sku as variant_sku
    FROM purchase_order_lines pol
    JOIN products p ON p.id = pol.product_id
    WHERE pol.purchase_order_id = ?
  `).bind(id).all();
  const invoice = await c.env.DB.prepare(
    "SELECT * FROM purchase_invoices WHERE purchase_order_id = ?"
  ).bind(id).first().catch(() => null);
  return c.json({
    po,
    lines,
    invoice,
    supplier: {
      name: po.supplier_name,
      contactName: po.contact_name,
      phone: po.supplier_phone,
      email: po.supplier_email,
      address: po.supplier_address
    },
    warehouse: {
      name: po.warehouse_name || "Central Warehouse",
      address: po.warehouse_address
    }
  });
});
purchasing.post("/orders", requirePermissions(["manage_purchasing"]), async (c) => {
  const body = await c.req.json();
  const userId = c.get("jwtPayload").sub;
  if (!body.supplierId) return c.json({ message: "Supplier is required." }, 400);
  const supplier = await c.env.DB.prepare("SELECT id FROM suppliers WHERE id = ?").bind(body.supplierId).first();
  if (!supplier) return c.json({ message: "Supplier does not exist." }, 400);
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: "At least one line item is required." }, 400);
  }
  const seenProducts = /* @__PURE__ */ new Set();
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    if (!line.quantity || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      return c.json({ message: `Line ${i + 1}: quantity must be a positive integer.` }, 400);
    }
    if (line.unitCost === void 0 || line.unitCost === null || Number(line.unitCost) < 0) {
      return c.json({ message: `Line ${i + 1}: unitCost cannot be negative.` }, 400);
    }
    if (seenProducts.has(line.productId)) {
      return c.json({ message: `Line ${i + 1}: duplicate product. Combine quantities into one line.` }, 400);
    }
    seenProducts.add(line.productId);
    const product = await c.env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(line.productId).first();
    if (!product) return c.json({ message: `Line ${i + 1}: product does not exist.` }, 400);
  }
  const id = uuidv4();
  const poNumber = `PO-${Date.now()}`;
  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO purchase_orders (id, po_number, supplier_id, warehouse_id, status, expected_date, created_by)
    VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?)
  `).bind(id, poNumber, body.supplierId, body.warehouseId || null, body.expectedDate || null, userId));
  for (const line of body.lines) {
    const discountAmount = Number(line.discountAmount || 0);
    const lineTotal = line.quantity * line.unitCost - discountAmount;
    stmts.push(c.env.DB.prepare(`
      INSERT INTO purchase_order_lines (id, purchase_order_id, product_id, quantity, unit_cost, discount_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(uuidv4(), id, line.productId, line.quantity, line.unitCost, discountAmount, lineTotal));
  }
  stmts.push(createAuditLogStmt(c, "PURCHASE_ORDER_CREATE", "purchase_orders", id, null, { poNumber, supplierId: body.supplierId, lines: body.lines }));
  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare("SELECT * FROM purchase_orders WHERE id = ?").bind(id).all();
  return c.json(results[0], 201);
});
purchasing.post("/orders/:id/approve", requirePermissions(["manage_purchasing"]), async (c) => {
  const id = c.req.param("id");
  const userId = c.get("jwtPayload").sub;
  const body = await c.req.json().catch(() => ({}));
  const po = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).bind(id).first();
  if (!po) return c.json({ message: "Purchase order not found." }, 404);
  if (po.status !== "SUBMITTED") {
    return c.json({ message: `Cannot approve: PO is currently '${po.status}'. Only SUBMITTED POs can be approved.` }, 400);
  }
  let warehouseId = body.warehouseId || po.warehouse_id;
  if (!warehouseId) {
    const firstWH = await c.env.DB.prepare("SELECT id FROM warehouses LIMIT 1").first();
    warehouseId = firstWH?.id;
  }
  if (!warehouseId) return c.json({ message: "No warehouse available to receive goods." }, 400);
  const { results: poLines } = await c.env.DB.prepare(`
    SELECT pol.*, pol.quantity AS quantity_ordered, p.name AS product_name, p.sku AS variant_sku
    FROM purchase_order_lines pol
    JOIN products p ON p.id = pol.product_id
    WHERE pol.purchase_order_id = ?
  `).bind(id).all();
  if (!poLines || poLines.length === 0) {
    return c.json({ message: "PO has no line items." }, 400);
  }
  const stockLookups = /* @__PURE__ */ new Map();
  await Promise.all(
    poLines.map(async (line) => {
      const existing = await c.env.DB.prepare(`
        SELECT id FROM inventory_stock
        WHERE product_id = ? AND owner_type = 'WAREHOUSE' AND warehouse_id = ? AND branch_id IS NULL
      `).bind(line.product_id, warehouseId).first();
      stockLookups.set(line.product_id, existing?.id || null);
    })
  );
  const receiptId = uuidv4();
  const receiptNumber = `GR-${Date.now()}`;
  const invoiceId = uuidv4();
  const invoiceNumber = `PI-${Date.now()}`;
  const approved_by = userId;
  const stmts = [];
  stmts.push(c.env.DB.prepare(
    "UPDATE purchase_orders SET status = 'RECEIVED', approved_by = ?, warehouse_id = ? WHERE id = ?"
  ).bind(approved_by, warehouseId, id));
  stmts.push(c.env.DB.prepare(`
    INSERT INTO goods_receipts (id, receipt_number, purchase_order_id, warehouse_id, received_by)
    VALUES (?, ?, ?, ?, ?)
  `).bind(receiptId, receiptNumber, id, warehouseId, userId));
  let grandTotal = 0;
  for (const line of poLines) {
    const qty = Number(line.quantity_ordered);
    const lineTotal = Number(line.line_total) || qty * Number(line.unit_cost) - Number(line.discount_amount || 0);
    grandTotal += lineTotal;
    stmts.push(c.env.DB.prepare(`
      INSERT INTO goods_receipt_lines (id, goods_receipt_id, product_id, warehouse_location_id, quantity_received)
      VALUES (?, ?, ?, NULL, ?)
    `).bind(uuidv4(), receiptId, line.product_id, qty));
    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_location_id, reference_type, reference_id, created_by)
      VALUES (?, ?, 'PURCHASE_RECEIPT', ?, 'WAREHOUSE', ?, NULL, 'GOODS_RECEIPT', ?, ?)
    `).bind(uuidv4(), line.product_id, qty, warehouseId, receiptId, userId));
    const existingStockId = stockLookups.get(line.product_id);
    if (existingStockId) {
      stmts.push(c.env.DB.prepare(
        "UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(qty, existingStockId));
    } else {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, warehouse_location_id, quantity_on_hand)
        VALUES (?, ?, 'WAREHOUSE', ?, NULL, ?)
      `).bind(uuidv4(), line.product_id, warehouseId, qty));
    }
  }
  stmts.push(c.env.DB.prepare(`
    INSERT INTO purchase_invoices (id, invoice_number, purchase_order_id, total_amount, status)
    VALUES (?, ?, ?, ?, 'PAID')
  `).bind(invoiceId, invoiceNumber, id, grandTotal));
  stmts.push(createAuditLogStmt(
    c,
    "PURCHASE_ORDER_APPROVE",
    "purchase_orders",
    id,
    { status: "SUBMITTED" },
    { status: "RECEIVED", warehouseId, receiptNumber, invoiceNumber }
  ));
  await c.env.DB.batch(stmts);
  const updated = await c.env.DB.prepare(`SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`).bind(id).first();
  const invoice = await c.env.DB.prepare("SELECT * FROM purchase_invoices WHERE purchase_order_id = ?").bind(id).first();
  return c.json({ ...updated, invoice });
});
purchasing.post("/receipts", requirePermissions(["manage_purchasing"]), async (c) => {
  const body = await c.req.json();
  const userId = c.get("jwtPayload").sub;
  if (!body.purchaseOrderId) return c.json({ message: "Purchase order ID is required." }, 400);
  const po = await c.env.DB.prepare("SELECT id, status FROM purchase_orders WHERE id = ?").bind(body.purchaseOrderId).first();
  if (!po) return c.json({ message: "Purchase order not found." }, 404);
  if (po.status !== "APPROVED" && po.status !== "PARTIALLY_RECEIVED") {
    return c.json({ message: `Cannot receive goods: PO is '${po.status}'. Must be APPROVED or PARTIALLY_RECEIVED.` }, 400);
  }
  if (!body.warehouseId) return c.json({ message: "Warehouse is required." }, 400);
  const wh = await c.env.DB.prepare("SELECT id FROM warehouses WHERE id = ?").bind(body.warehouseId).first();
  if (!wh) return c.json({ message: "Warehouse does not exist." }, 400);
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: "At least one receipt line is required." }, 400);
  }
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    if (!line.quantityReceived || !Number.isInteger(line.quantityReceived) || line.quantityReceived <= 0) {
      return c.json({ message: `Line ${i + 1}: quantityReceived must be a positive integer.` }, 400);
    }
    const poLine = await c.env.DB.prepare(
      "SELECT id, quantity FROM purchase_order_lines WHERE purchase_order_id = ? AND product_id = ?"
    ).bind(body.purchaseOrderId, line.productId).first();
    if (!poLine) {
      return c.json({ message: `Line ${i + 1}: product is not on this purchase order.` }, 400);
    }
    const alreadyReceived = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(grl.quantity_received), 0) as total
      FROM goods_receipt_lines grl
      JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id
      WHERE gr.purchase_order_id = ? AND grl.product_id = ?
    `).bind(body.purchaseOrderId, line.productId).first();
    const totalAfter = (alreadyReceived?.total || 0) + line.quantityReceived;
    if (totalAfter > poLine.quantity) {
      return c.json({
        message: `Line ${i + 1}: receiving ${line.quantityReceived} would total ${totalAfter}, but PO only ordered ${poLine.quantity}.`
      }, 400);
    }
  }
  const stockLookups = /* @__PURE__ */ new Map();
  await Promise.all(
    body.lines.map(async (line) => {
      const existingStock = await c.env.DB.prepare(`
        SELECT id FROM inventory_stock
        WHERE product_id = ? AND owner_type = 'WAREHOUSE' AND warehouse_id = ? AND branch_id IS NULL
          AND (warehouse_location_id = ? OR (warehouse_location_id IS NULL AND ? IS NULL))
      `).bind(line.productId, body.warehouseId, line.warehouseLocationId || null, line.warehouseLocationId || null).first();
      stockLookups.set(`${line.productId}:${line.warehouseLocationId || ""}`, existingStock?.id || null);
    })
  );
  const receiptId = uuidv4();
  const receiptNumber = `GR-${Date.now()}`;
  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO goods_receipts (id, receipt_number, purchase_order_id, warehouse_id, received_by)
    VALUES (?, ?, ?, ?, ?)
  `).bind(receiptId, receiptNumber, body.purchaseOrderId, body.warehouseId, userId));
  for (const line of body.lines) {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO goods_receipt_lines (id, goods_receipt_id, product_id, warehouse_location_id, quantity_received)
      VALUES (?, ?, ?, ?, ?)
    `).bind(uuidv4(), receiptId, line.productId, line.warehouseLocationId || null, line.quantityReceived));
    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_location_id, reference_type, reference_id, created_by)
      VALUES (?, ?, 'PURCHASE_RECEIPT', ?, 'WAREHOUSE', ?, ?, 'GOODS_RECEIPT', ?, ?)
    `).bind(uuidv4(), line.productId, line.quantityReceived, body.warehouseId, line.warehouseLocationId || null, receiptId, userId));
    const stockKey = `${line.productId}:${line.warehouseLocationId || ""}`;
    const existingStockId = stockLookups.get(stockKey);
    if (existingStockId) {
      stmts.push(c.env.DB.prepare(
        "UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(line.quantityReceived, existingStockId));
    } else {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, warehouse_location_id, quantity_on_hand)
        VALUES (?, ?, 'WAREHOUSE', ?, ?, ?)
      `).bind(uuidv4(), line.productId, body.warehouseId, line.warehouseLocationId || null, line.quantityReceived));
    }
  }
  const { results: poLines } = await c.env.DB.prepare(
    "SELECT pol.product_id, pol.quantity FROM purchase_order_lines pol WHERE pol.purchase_order_id = ?"
  ).bind(body.purchaseOrderId).all();
  const isIncompleteResults = await Promise.all(
    (poLines || []).map(async (poLine) => {
      const totalReceived = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(grl.quantity_received), 0) as total
        FROM goods_receipt_lines grl
        JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id
        WHERE gr.purchase_order_id = ? AND grl.product_id = ?
      `).bind(body.purchaseOrderId, poLine.product_id).first();
      const currentQty = body.lines.find((l) => l.productId === poLine.product_id)?.quantityReceived || 0;
      const total = (totalReceived?.total || 0) + currentQty;
      return total < poLine.quantity;
    })
  );
  const fullyReceived = !isIncompleteResults.includes(true);
  const newStatus = fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
  stmts.push(c.env.DB.prepare("UPDATE purchase_orders SET status = ? WHERE id = ?").bind(newStatus, body.purchaseOrderId));
  stmts.push(createAuditLogStmt(c, "GOODS_RECEIPT_CREATE", "goods_receipts", receiptId, null, { receiptNumber, purchaseOrderId: body.purchaseOrderId, warehouseId: body.warehouseId, lines: body.lines, newPoStatus: newStatus }));
  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare("SELECT * FROM goods_receipts WHERE id = ?").bind(receiptId).all();
  return c.json(results[0], 201);
});
var purchasing_default = purchasing;

// src/routes/sales.ts
var sales = new Hono2();
sales.use("/*", authMiddleware);
sales.get("/customers", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM customers ORDER BY created_at DESC LIMIT 100").all();
  return c.json(results);
});
sales.post("/customers", requirePermissions(["manage_sales"]), async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.name.trim()) {
    return c.json({ message: "Customer name is required." }, 400);
  }
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO customers (id, name, phone, email, address)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, body.name.trim(), body.phone || null, body.email || null, body.address || null).run();
  const { results } = await c.env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(id).all();
  return c.json(results[0], 201);
});
sales.get("/orders", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT so.*, c.name AS customer_name, b.name AS branch_name, i.id AS invoice_id
    FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    JOIN branches b ON b.id = so.branch_id
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    ORDER BY so.created_at DESC
    LIMIT 100
  `).all();
  return c.json(results);
});
sales.get("/orders/:id", async (c) => {
  const id = c.req.param("id");
  const { results: orders } = await c.env.DB.prepare(`
    SELECT so.*, c.name AS customer_name, b.name AS branch_name,
           i.id AS invoice_id, i.invoice_number, i.total_amount AS invoice_total, i.status AS invoice_status
    FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    JOIN branches b ON b.id = so.branch_id
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    WHERE so.id = ?
  `).bind(id).all();
  if (!orders.length) return c.json({ message: "Not found" }, 404);
  const order = orders[0];
  const { results: lines } = await c.env.DB.prepare(`
    SELECT sol.*, p.name AS product_name, p.sku AS product_sku
    FROM sales_order_lines sol
    LEFT JOIN products p ON p.id = sol.product_id
    WHERE sol.sales_order_id = ?
  `).bind(id).all();
  return c.json({ ...order, lines });
});
sales.post("/orders", requirePermissions(["manage_sales"]), async (c) => {
  const body = await c.req.json();
  const userId = c.get("jwtPayload").sub;
  if (!body.branchId) return c.json({ message: "Branch is required." }, 400);
  const branch = await c.env.DB.prepare("SELECT id FROM branches WHERE id = ?").bind(body.branchId).first();
  if (!branch) return c.json({ message: "Branch does not exist." }, 400);
  if (body.customerId) {
    const customer = await c.env.DB.prepare("SELECT id FROM customers WHERE id = ?").bind(body.customerId).first();
    if (!customer) return c.json({ message: "Customer does not exist." }, 400);
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: "At least one order line is required." }, 400);
  }
  const seenProducts = /* @__PURE__ */ new Set();
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    if (!line.quantity || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      return c.json({ message: `Line ${i + 1}: quantity must be a positive integer.` }, 400);
    }
    if (line.unitPrice === void 0 || line.unitPrice === null || Number(line.unitPrice) < 0) {
      return c.json({ message: `Line ${i + 1}: unitPrice cannot be negative.` }, 400);
    }
    if (seenProducts.has(line.productId)) {
      return c.json({ message: `Line ${i + 1}: duplicate product. Combine quantities into one line.` }, 400);
    }
    seenProducts.add(line.productId);
    const product = await c.env.DB.prepare("SELECT id, selling_price FROM products WHERE id = ?").bind(line.productId).first();
    if (!product) return c.json({ message: `Line ${i + 1}: product does not exist.` }, 400);
    line.unitPrice = product.selling_price;
  }
  const id = uuidv4();
  const orderNumber = `SO-${Date.now()}`;
  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO sales_orders (id, order_number, customer_id, branch_id, status, created_by)
    VALUES (?, ?, ?, ?, 'DRAFT', ?)
  `).bind(id, orderNumber, body.customerId || null, body.branchId, userId));
  for (const line of body.lines) {
    const discountAmount = Number(line.discountAmount || 0);
    const lineTotal = line.quantity * line.unitPrice - discountAmount;
    stmts.push(c.env.DB.prepare(`
      INSERT INTO sales_order_lines (id, sales_order_id, product_id, quantity, unit_price, discount_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(uuidv4(), id, line.productId, line.quantity, line.unitPrice, discountAmount, lineTotal));
  }
  stmts.push(createAuditLogStmt(c, "SALES_ORDER_CREATE", "sales_orders", id, null, { orderNumber, branchId: body.branchId, customerId: body.customerId, lines: body.lines }));
  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare("SELECT * FROM sales_orders WHERE id = ?").bind(id).all();
  return c.json(results[0], 201);
});
sales.post("/orders/:id/confirm", requirePermissions(["manage_sales"]), async (c) => {
  const id = c.req.param("id");
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ? AND status = 'DRAFT'"
  ).bind(id).run();
  if (!cas.meta.changes || cas.meta.changes === 0) {
    const existing = await c.env.DB.prepare("SELECT status FROM sales_orders WHERE id = ?").bind(id).first();
    if (!existing) return c.json({ message: "Order not found." }, 404);
    return c.json({ message: `Cannot confirm: order is currently '${existing.status}'. Only DRAFT orders can be confirmed.` }, 400);
  }
  await logAudit(c, "SALES_ORDER_CONFIRM", "sales_orders", id, { status: "DRAFT" }, { status: "CONFIRMED" });
  const { results } = await c.env.DB.prepare("SELECT * FROM sales_orders WHERE id = ?").bind(id).all();
  return c.json(results[0]);
});
sales.post("/orders/:id/invoice", requirePermissions(["manage_sales"]), async (c) => {
  const orderId = c.req.param("id");
  const userId = c.get("jwtPayload").sub;
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'INVOICING' WHERE id = ? AND status = 'CONFIRMED'"
  ).bind(orderId).run();
  if (!cas.meta.changes || cas.meta.changes === 0) {
    const existing = await c.env.DB.prepare("SELECT status FROM sales_orders WHERE id = ?").bind(orderId).first();
    if (!existing) return c.json({ message: "Order not found." }, 404);
    if (existing.status === "INVOICED" || existing.status === "PAID") {
      return c.json({ message: "This order has already been invoiced." }, 409);
    }
    return c.json({ message: `Cannot invoice: order is currently '${existing.status}'. Only CONFIRMED orders can be invoiced.` }, 400);
  }
  try {
    const existingInvoice = await c.env.DB.prepare(
      "SELECT id FROM invoices WHERE sales_order_id = ?"
    ).bind(orderId).first();
    if (existingInvoice) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: "An invoice already exists for this order." }, 409);
    }
    const order = await c.env.DB.prepare("SELECT * FROM sales_orders WHERE id = ?").bind(orderId).first();
    const branchId = order?.branch_id;
    const { results: lines } = await c.env.DB.prepare(
      "SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?"
    ).bind(orderId).all();
    if (!lines || lines.length === 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: "Order has no line items." }, 400);
    }
    const insufficientLines = [];
    const stockMap = /* @__PURE__ */ new Map();
    await Promise.all(
      lines.map(async (line) => {
        const stock = await c.env.DB.prepare(`
          SELECT id, quantity_on_hand FROM inventory_stock
          WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
        `).bind(line.product_id, branchId).first();
        const available = stock?.quantity_on_hand || 0;
        const requested = line.quantity;
        if (available < requested) {
          const prod = await c.env.DB.prepare("SELECT name FROM products WHERE id = ?").bind(line.product_id).first();
          insufficientLines.push(`${prod?.name || line.product_id}: need ${requested}, available ${available}`);
        }
        stockMap.set(line.product_id, {
          stockId: stock?.id || "",
          qtyOnHand: available
        });
      })
    );
    if (insufficientLines.length > 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: "Insufficient stock for this sale.", details: insufficientLines }, 400);
    }
    const totalRes = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(quantity * unit_price), 0) AS total FROM sales_order_lines WHERE sales_order_id = ?"
    ).bind(orderId).first();
    const total = totalRes?.total || 0;
    const invoiceId = uuidv4();
    const stmts = [];
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoices (id, invoice_number, sales_order_id, total_amount)
      VALUES (?, ?, ?, ?)
    `).bind(invoiceId, `INV-${Date.now()}`, orderId, total));
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoice_lines (id, invoice_id, product_id, quantity, unit_price)
      SELECT lower(hex(randomblob(16))), ?, product_id, quantity, unit_price FROM sales_order_lines WHERE sales_order_id = ?
    `).bind(invoiceId, orderId));
    for (const line of lines) {
      const qty = line.quantity;
      stmts.push(c.env.DB.prepare(`
        UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
      `).bind(qty, line.product_id, branchId));
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_branch_id, reference_type, reference_id, created_by)
        VALUES (?, ?, 'SALE_ISSUE', ?, 'BRANCH', ?, 'INVOICE', ?, ?)
      `).bind(uuidv4(), line.product_id, -qty, branchId, invoiceId, userId));
    }
    stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId));
    stmts.push(createAuditLogStmt(c, "SALES_ORDER_INVOICE", "sales_orders", orderId, { status: "CONFIRMED" }, { status: "INVOICED", invoiceId, total }));
    await c.env.DB.batch(stmts);
    const { results } = await c.env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(invoiceId).all();
    return c.json(results[0], 201);
  } catch (err) {
    try {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
    } catch (_) {
    }
    console.error("Invoice creation failed:", err);
    return c.json({ message: "Invoice creation failed. Order rolled back to CONFIRMED.", error: err?.message }, 500);
  }
});
sales.post("/orders/:id/pay", requirePermissions(["manage_sales"]), async (c) => {
  const orderId = c.req.param("id");
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'PAYING' WHERE id = ? AND status = 'INVOICED'"
  ).bind(orderId).run();
  if (!cas.meta.changes || cas.meta.changes === 0) {
    const existing = await c.env.DB.prepare("SELECT status FROM sales_orders WHERE id = ?").bind(orderId).first();
    if (!existing) return c.json({ message: "Order not found." }, 404);
    if (existing.status === "PAID") return c.json({ message: "This order is already paid." }, 409);
    if (existing.status === "PAYING") return c.json({ message: "Payment is already being processed by another request." }, 409);
    return c.json({ message: `Cannot pay: order is currently '${existing.status}'. Only INVOICED orders can be paid.` }, 400);
  }
  try {
    const invoice = await c.env.DB.prepare(
      "SELECT id, status FROM invoices WHERE sales_order_id = ?"
    ).bind(orderId).first();
    if (!invoice) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: "No invoice found for this order." }, 400);
    }
    if (invoice.status === "PAID") {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId).run();
      return c.json({ message: "Invoice is already paid." }, 409);
    }
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?").bind(invoice.id),
      c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId),
      createAuditLogStmt(c, "SALES_ORDER_PAY", "sales_orders", orderId, { status: "INVOICED" }, { status: "PAID", invoiceId: invoice.id })
    ]);
    return c.json({ success: true });
  } catch (err) {
    try {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId).run();
    } catch (_) {
    }
    return c.json({ message: "Payment processing failed. Order rolled back to INVOICED.", error: err?.message }, 500);
  }
});
sales.post("/orders/:id/complete", requirePermissions(["manage_sales"]), async (c) => {
  const orderId = c.req.param("id");
  const userId = c.get("jwtPayload").sub;
  const order = await c.env.DB.prepare("SELECT * FROM sales_orders WHERE id = ?").bind(orderId).first();
  if (!order) return c.json({ message: "Order not found." }, 404);
  if (order.status === "PAID") return c.json({ message: "Order is already completed." }, 409);
  if (order.status === "INVOICED") {
    const invoice = await c.env.DB.prepare("SELECT id, status FROM invoices WHERE sales_order_id = ?").bind(orderId).first();
    if (!invoice) return c.json({ message: "Order is INVOICED but no invoice found." }, 500);
    if (invoice.status === "PAID") {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId).run();
      return c.json({ success: true, message: "Payment recorded." });
    }
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?").bind(invoice.id),
      c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId),
      createAuditLogStmt(c, "SALES_ORDER_COMPLETE", "sales_orders", orderId, { status: "INVOICED" }, { status: "PAID", invoiceId: invoice.id })
    ]);
    return c.json({ success: true, invoiceId: invoice.id });
  }
  const validSource = order.status === "DRAFT" ? "DRAFT" : "CONFIRMED";
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'PROCESSING' WHERE id = ? AND status = ?"
  ).bind(orderId, validSource).run();
  if (!cas.meta.changes || cas.meta.changes === 0) {
    return c.json({ message: "Order state changed concurrently. Please refresh and try again." }, 409);
  }
  try {
    const existingInvoice = await c.env.DB.prepare("SELECT id FROM invoices WHERE sales_order_id = ?").bind(orderId).first();
    if (existingInvoice) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ?").bind(validSource).run();
      return c.json({ message: "An invoice already exists for this order." }, 409);
    }
    const branchId = order.branch_id;
    const { results: lines } = await c.env.DB.prepare(
      "SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?"
    ).bind(orderId).all();
    if (!lines || lines.length === 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
      return c.json({ message: "Order has no line items." }, 400);
    }
    const insufficientLines = [];
    for (const line of lines) {
      const stock = await c.env.DB.prepare(`
        SELECT quantity_on_hand FROM inventory_stock
        WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
      `).bind(line.product_id, branchId).first();
      const available = stock?.quantity_on_hand || 0;
      const requested = line.quantity;
      if (available < requested) {
        const prod = await c.env.DB.prepare("SELECT name FROM products WHERE id = ?").bind(line.product_id).first();
        insufficientLines.push(`${prod?.name || line.product_id}: need ${requested}, available ${available}`);
      }
    }
    if (insufficientLines.length > 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
      return c.json({ message: "Insufficient stock for this sale.", details: insufficientLines }, 400);
    }
    const totalRes = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(quantity * unit_price), 0) AS total FROM sales_order_lines WHERE sales_order_id = ?"
    ).bind(orderId).first();
    const total = totalRes?.total || 0;
    const invoiceId = uuidv4();
    const stmts = [];
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoices (id, invoice_number, sales_order_id, total_amount, status, paid_at)
      VALUES (?, ?, ?, ?, 'PAID', CURRENT_TIMESTAMP)
    `).bind(invoiceId, `INV-${Date.now()}`, orderId, total));
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoice_lines (id, invoice_id, product_id, quantity, unit_price)
      SELECT lower(hex(randomblob(16))), ?, product_id, quantity, unit_price FROM sales_order_lines WHERE sales_order_id = ?
    `).bind(invoiceId, orderId));
    for (const line of lines) {
      const qty = line.quantity;
      stmts.push(c.env.DB.prepare(`
        UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
      `).bind(qty, line.product_id, branchId));
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_branch_id, reference_type, reference_id, created_by)
        VALUES (?, ?, 'SALE_ISSUE', ?, 'BRANCH', ?, 'INVOICE', ?, ?)
      `).bind(uuidv4(), line.product_id, -qty, branchId, invoiceId, userId));
    }
    stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId));
    stmts.push(createAuditLogStmt(c, "SALES_ORDER_COMPLETE", "sales_orders", orderId, { status: validSource }, { status: "PAID", invoiceId, total }));
    await c.env.DB.batch(stmts);
    return c.json({ success: true, invoiceId, total });
  } catch (err) {
    try {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
    } catch (_) {
    }
    console.error("Order completion failed:", err);
    return c.json({ message: "Order completion failed. Rolled back.", error: err?.message }, 500);
  }
});
sales.get("/invoices/:id/print", async (c) => {
  const invoiceId = c.req.param("id");
  const invoice = await c.env.DB.prepare(`
    SELECT i.*, so.order_number, so.branch_id,
           c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, c.address AS customer_address,
           b.name AS branch_name, b.city AS branch_city, b.address AS branch_address, b.phone AS branch_phone
    FROM invoices i
    JOIN sales_orders so ON so.id = i.sales_order_id
    LEFT JOIN customers c ON c.id = so.customer_id
    JOIN branches b ON b.id = so.branch_id
    WHERE i.id = ?
  `).bind(invoiceId).first();
  if (!invoice) return c.json({ message: "Invoice not found." }, 404);
  const { results: lines } = await c.env.DB.prepare(`
    SELECT il.*, p.name AS product_name, p.sku AS product_sku, p.barcode AS product_barcode
    FROM invoice_lines il
    JOIN products p ON p.id = il.product_id
    WHERE il.invoice_id = ?
  `).bind(invoiceId).all();
  return c.json({
    invoice: {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      order_number: invoice.order_number,
      status: invoice.status,
      total_amount: invoice.total_amount,
      issued_at: invoice.issued_at,
      paid_at: invoice.paid_at
    },
    customer: {
      name: invoice.customer_name || "Walk-in Customer",
      phone: invoice.customer_phone || null,
      email: invoice.customer_email || null,
      address: invoice.customer_address || null
    },
    branch: {
      name: invoice.branch_name,
      city: invoice.branch_city,
      address: invoice.branch_address,
      phone: invoice.branch_phone
    },
    lines: lines.map((l) => ({
      product_name: l.product_name,
      product_sku: l.product_sku,
      product_barcode: l.product_barcode,
      quantity: l.quantity,
      unit_price: l.unit_price,
      subtotal: l.quantity * l.unit_price
    }))
  });
});
var sales_default = sales;

// src/routes/reports.ts
var reports = new Hono2();
reports.use("/*", authMiddleware, requirePermissions(["view_reports"]));
function getDaysParam(c) {
  const daysStr = c.req.query("days");
  const parsed = parseInt(daysStr || "30", 10);
  return isNaN(parsed) || parsed <= 0 ? 30 : Math.min(parsed, 3650);
}
__name(getDaysParam, "getDaysParam");
reports.get("/low-stock", async (c) => {
  const warehouseId = c.req.query("warehouseId") || null;
  const branchId = c.req.query("branchId") || null;
  const categoryId = c.req.query("categoryId") || null;
  let query = `
    SELECT 
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      p.barcode,
      c.name AS category_name,
      s.owner_type,
      s.warehouse_id,
      s.branch_id,
      COALESCE(s.quantity_on_hand, 0) AS quantity_on_hand,
      p.reorder_level,
      w.name AS warehouse_name,
      b.name AS branch_name,
      CASE 
        WHEN COALESCE(s.quantity_on_hand, 0) <= 0 THEN 'CRITICAL'
        WHEN COALESCE(s.quantity_on_hand, 0) <= p.reorder_level THEN 'LOW'
        ELSE 'OK'
      END AS status_risk
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN branches b ON b.id = s.branch_id
    WHERE 1=1
  `;
  const params = [];
  if (warehouseId) {
    query += ` AND s.warehouse_id = ?`;
    params.push(warehouseId);
  }
  if (branchId) {
    query += ` AND s.branch_id = ?`;
    params.push(branchId);
  }
  if (categoryId) {
    query += ` AND p.category_id = ?`;
    params.push(categoryId);
  }
  if (!warehouseId && !branchId && !categoryId) {
    query += ` AND s.quantity_on_hand <= p.reorder_level`;
  }
  query += ` ORDER BY (COALESCE(s.quantity_on_hand, 0) - p.reorder_level) ASC, p.name ASC`;
  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json(results || []);
});
reports.get("/branch-performance", async (c) => {
  const days = getDaysParam(c);
  const daysModifier = `-${days} days`;
  const { results } = await c.env.DB.prepare(`
    SELECT 
      b.id,
      b.code,
      b.name,
      b.city,
      COUNT(DISTINCT so.id) AS order_count,
      COALESCE(SUM(i.total_amount), 0) AS total_revenue,
      COALESCE(SUM(
        (SELECT COALESCE(SUM(il.quantity * (il.unit_price - p.cost_price)), 0)
         FROM invoice_lines il 
         JOIN products p ON p.id = il.product_id 
         WHERE il.invoice_id = i.id)
      ), 0) AS gross_profit
    FROM branches b
    LEFT JOIN sales_orders so ON so.branch_id = b.id AND so.created_at >= DATE('now', ?)
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    GROUP BY b.id, b.code, b.name, b.city
    ORDER BY total_revenue DESC
  `).bind(daysModifier).all();
  const formatted = (results || []).map((r) => {
    const revenue = Number(r.total_revenue || 0);
    const profit = Number(r.gross_profit || 0);
    const orders = Number(r.order_count || 0);
    return {
      ...r,
      total_revenue: revenue,
      gross_profit: profit,
      order_count: orders,
      avg_order_value: orders > 0 ? revenue / orders : 0,
      margin_pct: revenue > 0 ? profit / revenue * 100 : 0
    };
  });
  return c.json(formatted);
});
reports.get("/inventory-valuation", async (c) => {
  const categoryId = c.req.query("categoryId") || null;
  const summaryRes = await c.env.DB.prepare(`
    SELECT 
      COALESCE(SUM(s.quantity_on_hand * p.cost_price), 0) AS total_cost_value,
      COALESCE(SUM(s.quantity_on_hand * p.selling_price), 0) AS total_retail_value,
      COALESCE(SUM(s.quantity_on_hand), 0) AS total_units
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
  `).first();
  let catQuery = `
    SELECT 
      COALESCE(c.name, 'Uncategorized') AS category_name,
      COALESCE(SUM(s.quantity_on_hand * p.cost_price), 0) AS cost_value,
      COALESCE(SUM(s.quantity_on_hand), 0) AS units
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN categories c ON c.id = p.category_id
  `;
  if (categoryId) {
    catQuery += ` WHERE p.category_id = ?`;
  }
  catQuery += ` GROUP BY c.id, c.name ORDER BY cost_value DESC`;
  const catStmt = c.env.DB.prepare(catQuery);
  const { results: categoryBreakdown } = categoryId ? await catStmt.bind(categoryId).all() : await catStmt.all();
  const { results: deadStock } = await c.env.DB.prepare(`
    SELECT 
      p.id,
      p.sku,
      p.name AS product_name,
      COALESCE(c.name, 'Uncategorized') AS category_name,
      SUM(s.quantity_on_hand) AS units_on_hand,
      p.cost_price,
      (SUM(s.quantity_on_hand) * p.cost_price) AS tied_up_capital
    FROM products p
    JOIN inventory_stock s ON s.product_id = p.id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id NOT IN (
      SELECT DISTINCT sol.product_id
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.sales_order_id
      WHERE so.created_at >= DATE('now', '-90 days')
    )
    GROUP BY p.id, p.sku, p.name, c.name, p.cost_price
    HAVING units_on_hand > 0
    ORDER BY tied_up_capital DESC
    LIMIT 25
  `).all();
  return c.json({
    summary: {
      total_cost_value: Number(summaryRes?.total_cost_value || 0),
      total_retail_value: Number(summaryRes?.total_retail_value || 0),
      total_units: Number(summaryRes?.total_units || 0)
    },
    category_breakdown: categoryBreakdown || [],
    dead_stock: deadStock || []
  });
});
reports.get("/sales-profit", async (c) => {
  const days = getDaysParam(c);
  const daysModifier = `-${days} days`;
  const { results: dailyTrend } = await c.env.DB.prepare(`
    SELECT 
      DATE(so.created_at) AS day,
      COUNT(DISTINCT so.id) AS order_count,
      COALESCE(SUM(sol.quantity * sol.unit_price), 0) AS revenue,
      COALESCE(SUM(sol.quantity * (sol.unit_price - p.cost_price)), 0) AS profit
    FROM sales_orders so
    JOIN sales_order_lines sol ON sol.sales_order_id = so.id
    JOIN products p ON p.id = sol.product_id
    WHERE so.created_at >= DATE('now', ?)
    GROUP BY DATE(so.created_at)
    ORDER BY day ASC
  `).bind(daysModifier).all();
  let totalRevenue = 0;
  let totalProfit = 0;
  let totalOrders = 0;
  (dailyTrend || []).forEach((d) => {
    totalRevenue += Number(d.revenue || 0);
    totalProfit += Number(d.profit || 0);
    totalOrders += Number(d.order_count || 0);
  });
  const { results: topProducts } = await c.env.DB.prepare(`
    SELECT 
      p.id,
      p.name AS product_name,
      p.sku,
      COALESCE(b.name, 'N/A') AS brand_name,
      COALESCE(c.name, 'N/A') AS category_name,
      SUM(sol.quantity) AS units_sold,
      SUM(sol.quantity * sol.unit_price) AS revenue,
      SUM(sol.quantity * (sol.unit_price - p.cost_price)) AS profit
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    JOIN products p ON p.id = sol.product_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE so.created_at >= DATE('now', ?)
    GROUP BY p.id, p.name, p.sku, b.name, c.name
    ORDER BY profit DESC
    LIMIT 15
  `).bind(daysModifier).all();
  const formattedProducts = (topProducts || []).map((p) => {
    const rev = Number(p.revenue || 0);
    const prof = Number(p.profit || 0);
    return {
      ...p,
      revenue: rev,
      profit: prof,
      margin_pct: rev > 0 ? prof / rev * 100 : 0
    };
  });
  const { results: topCustomers } = await c.env.DB.prepare(`
    SELECT 
      cust.id,
      cust.name AS customer_name,
      COUNT(DISTINCT so.id) AS order_count,
      COALESCE(SUM(sol.quantity * sol.unit_price), 0) AS total_spent,
      MAX(so.created_at) AS last_order_date
    FROM customers cust
    JOIN sales_orders so ON so.customer_id = cust.id
    JOIN sales_order_lines sol ON sol.sales_order_id = so.id
    WHERE so.created_at >= DATE('now', ?)
    GROUP BY cust.id, cust.name
    ORDER BY total_spent DESC
    LIMIT 15
  `).bind(daysModifier).all();
  return c.json({
    summary: {
      total_revenue: totalRevenue,
      gross_profit: totalProfit,
      total_orders: totalOrders,
      avg_order_value: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      margin_pct: totalRevenue > 0 ? totalProfit / totalRevenue * 100 : 0
    },
    daily_trend: dailyTrend || [],
    top_products: formattedProducts,
    top_customers: topCustomers || []
  });
});
reports.get("/quote-conversion", async (c) => {
  const days = getDaysParam(c);
  const daysModifier = `-${days} days`;
  const summaryRes = await c.env.DB.prepare(`
    SELECT 
      COUNT(*) AS total_quotes,
      SUM(CASE WHEN status IN ('ACCEPTED', 'CONVERTED') OR id IN (SELECT DISTINCT quotation_id FROM sales_orders WHERE quotation_id IS NOT NULL) THEN 1 ELSE 0 END) AS converted_quotes,
      AVG(CASE WHEN id IN (SELECT DISTINCT quotation_id FROM sales_orders WHERE quotation_id IS NOT NULL) THEN 
        (JULIANDAY((SELECT created_at FROM sales_orders WHERE quotation_id = q.id LIMIT 1)) - JULIANDAY(q.created_at))
      ELSE NULL END) AS avg_days_to_convert
    FROM quotations q
    WHERE q.created_at >= DATE('now', ?)
  `).bind(daysModifier).first();
  const totalQuotes = Number(summaryRes?.total_quotes || 0);
  const convertedQuotes = Number(summaryRes?.converted_quotes || 0);
  const { results: trend } = await c.env.DB.prepare(`
    SELECT 
      DATE(q.created_at) AS day,
      COUNT(*) AS total_created,
      SUM(CASE WHEN q.status IN ('ACCEPTED', 'CONVERTED') OR q.id IN (SELECT DISTINCT quotation_id FROM sales_orders WHERE quotation_id IS NOT NULL) THEN 1 ELSE 0 END) AS total_converted
    FROM quotations q
    WHERE q.created_at >= DATE('now', ?)
    GROUP BY DATE(q.created_at)
    ORDER BY day ASC
  `).bind(daysModifier).all();
  const { results: quotesList } = await c.env.DB.prepare(`
    SELECT 
      q.id,
      q.quotation_number,
      c.name AS customer_name,
      b.name AS branch_name,
      q.status,
      q.created_at,
      so.id AS sales_order_id,
      so.order_number AS sales_order_number,
      so.created_at AS order_created_at,
      ROUND(JULIANDAY(so.created_at) - JULIANDAY(q.created_at), 1) AS days_to_convert
    FROM quotations q
    LEFT JOIN customers c ON c.id = q.customer_id
    LEFT JOIN branches b ON b.id = q.branch_id
    LEFT JOIN sales_orders so ON so.quotation_id = q.id
    WHERE q.created_at >= DATE('now', ?)
    ORDER BY q.created_at DESC
    LIMIT 30
  `).bind(daysModifier).all();
  return c.json({
    summary: {
      total_quotes: totalQuotes,
      converted_quotes: convertedQuotes,
      conversion_rate_pct: totalQuotes > 0 ? convertedQuotes / totalQuotes * 100 : 0,
      avg_days_to_convert: Number((summaryRes?.avg_days_to_convert || 0).toFixed(1))
    },
    trend: trend || [],
    quotes_list: quotesList || []
  });
});
reports.get("/supplier-performance", async (c) => {
  const days = getDaysParam(c);
  const daysModifier = `-${days} days`;
  const summaryRes = await c.env.DB.prepare(`
    SELECT 
      COUNT(DISTINCT po.id) AS po_count,
      COUNT(DISTINCT po.supplier_id) AS active_suppliers,
      COALESCE(SUM(pol.quantity * pol.unit_cost), 0) AS total_spend,
      SUM(CASE WHEN gr.id IS NOT NULL AND DATE(gr.received_at) <= DATE(po.expected_date) THEN 1 ELSE 0 END) AS on_time_count,
      COUNT(DISTINCT gr.id) AS total_received_gr
    FROM purchase_orders po
    LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    LEFT JOIN goods_receipts gr ON gr.purchase_order_id = po.id
    WHERE po.created_at >= DATE('now', ?)
  `).bind(daysModifier).first();
  const { results: supplierSpend } = await c.env.DB.prepare(`
    SELECT 
      s.name AS supplier_name,
      COUNT(DISTINCT po.id) AS po_count,
      COALESCE(SUM(pol.quantity * pol.unit_cost), 0) AS total_spend
    FROM suppliers s
    JOIN purchase_orders po ON po.supplier_id = s.id
    LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    WHERE po.created_at >= DATE('now', ?)
    GROUP BY s.id, s.name
    ORDER BY total_spend DESC
  `).bind(daysModifier).all();
  const { results: scorecard } = await c.env.DB.prepare(`
    SELECT 
      s.id,
      s.name AS supplier_name,
      s.contact_name,
      s.phone,
      s.email,
      COUNT(DISTINCT po.id) AS total_pos,
      COALESCE(SUM(pol.quantity * pol.unit_cost), 0) AS total_spend,
      SUM(CASE WHEN gr.id IS NOT NULL THEN 1 ELSE 0 END) AS received_pos,
      SUM(CASE WHEN gr.id IS NOT NULL AND po.expected_date IS NOT NULL AND DATE(gr.received_at) <= DATE(po.expected_date) THEN 1 ELSE 0 END) AS on_time_pos
    FROM suppliers s
    LEFT JOIN purchase_orders po ON po.supplier_id = s.id AND po.created_at >= DATE('now', ?)
    LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    LEFT JOIN goods_receipts gr ON gr.purchase_order_id = po.id
    GROUP BY s.id, s.name, s.contact_name, s.phone, s.email
    ORDER BY total_spend DESC
  `).bind(daysModifier).all();
  const formattedScorecard = (scorecard || []).map((sc) => {
    const received = Number(sc.received_pos || 0);
    const onTime = Number(sc.on_time_pos || 0);
    return {
      ...sc,
      total_spend: Number(sc.total_spend || 0),
      on_time_delivery_pct: received > 0 ? onTime / received * 100 : 100
    };
  });
  const totalReceived = Number(summaryRes?.total_received_gr || 0);
  const onTimeCount = Number(summaryRes?.on_time_count || 0);
  return c.json({
    summary: {
      po_count: Number(summaryRes?.po_count || 0),
      active_suppliers: Number(summaryRes?.active_suppliers || 0),
      total_spend: Number(summaryRes?.total_spend || 0),
      on_time_delivery_rate_pct: totalReceived > 0 ? onTimeCount / totalReceived * 100 : 100
    },
    supplier_spend: supplierSpend || [],
    scorecard: formattedScorecard
  });
});
reports.get("/receivables", async (c) => {
  const days = getDaysParam(c);
  const { results: invoices } = await c.env.DB.prepare(`
    SELECT 
      i.id,
      i.invoice_number,
      i.status,
      i.total_amount,
      i.issued_at,
      i.paid_at,
      cust.name AS customer_name,
      so.order_number,
      CAST(
        CASE 
          WHEN i.status = 'PAID' THEN 0
          ELSE (JULIANDAY('now') - JULIANDAY(i.issued_at))
        END AS INTEGER
      ) AS days_outstanding
    FROM invoices i
    JOIN sales_orders so ON so.id = i.sales_order_id
    LEFT JOIN customers cust ON cust.id = so.customer_id
    ORDER BY i.issued_at DESC
  `).all();
  let totalInvoiced = 0;
  let totalPaid = 0;
  let totalOutstanding = 0;
  let current0to30 = 0;
  let overdue31to60 = 0;
  let overdue61to90 = 0;
  let overdue90plus = 0;
  const formattedInvoices = (invoices || []).map((inv) => {
    const amt = Number(inv.total_amount || 0);
    const status = inv.status;
    const daysOut = Number(inv.days_outstanding || 0);
    totalInvoiced += amt;
    if (status === "PAID") {
      totalPaid += amt;
    } else {
      totalOutstanding += amt;
      if (daysOut <= 30) {
        current0to30 += amt;
      } else if (daysOut <= 60) {
        overdue31to60 += amt;
      } else if (daysOut <= 90) {
        overdue61to90 += amt;
      } else {
        overdue90plus += amt;
      }
    }
    return {
      ...inv,
      total_amount: amt,
      days_outstanding: daysOut,
      aging_bracket: status === "PAID" ? "Paid" : daysOut <= 30 ? "0-30 Days" : daysOut <= 60 ? "31-60 Days" : daysOut <= 90 ? "61-90 Days" : "90+ Days"
    };
  });
  const agingBreakdown = [
    { bracket: "0-30 Days (Current)", amount: current0to30 },
    { bracket: "31-60 Days Overdue", amount: overdue31to60 },
    { bracket: "61-90 Days Overdue", amount: overdue61to90 },
    { bracket: "90+ Days Overdue", amount: overdue90plus }
  ];
  return c.json({
    summary: {
      total_invoiced: totalInvoiced,
      total_paid: totalPaid,
      total_outstanding: totalOutstanding,
      total_overdue: overdue31to60 + overdue61to90 + overdue90plus
    },
    aging_breakdown: agingBreakdown,
    invoices: formattedInvoices
  });
});
var reports_default = reports;

// src/routes/users.ts
var bcrypt2 = __toESM(require_bcrypt());
var users = new Hono2();
users.use("/*", authMiddleware, requirePermissions(["manage_users"]));
users.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT id, email, full_name, phone, branch_id, warehouse_id, is_active, last_login_at, created_at 
    FROM users ORDER BY created_at DESC
  `).all();
  return c.json(results);
});
users.get("/roles", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM roles ORDER BY name ASC").all();
  return c.json(results);
});
users.get("/:id/roles", async (c) => {
  const id = c.req.param("id");
  const { results } = await c.env.DB.prepare(`
    SELECT r.id, r.name, r.description FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `).bind(id).all();
  return c.json(results);
});
users.post("/", async (c) => {
  const body = await c.req.json();
  if (!body.email || !body.email.trim()) return c.json({ message: "Email is required." }, 400);
  if (!body.password || body.password.length < 6) return c.json({ message: "Password must be at least 6 characters." }, 400);
  if (!body.fullName || !body.fullName.trim()) return c.json({ message: "Full name is required." }, 400);
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(body.email.trim()).first();
  if (existing) return c.json({ message: "A user with this email already exists." }, 409);
  const id = uuidv4();
  const passwordHash = bcrypt2.hashSync(body.password, 12);
  await c.env.DB.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, branch_id, warehouse_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, body.email.trim(), passwordHash, body.fullName.trim(), body.phone || null, body.branchId || null, body.warehouseId || null).run();
  if (body.roleIds && body.roleIds.length > 0) {
    const stmts = body.roleIds.map(
      (rId) => c.env.DB.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(id, rId)
    );
    await c.env.DB.batch(stmts);
  }
  const { results } = await c.env.DB.prepare("SELECT id, email, full_name FROM users WHERE id = ?").bind(id).all();
  await logAudit(c, "USER_CREATE", "users", id, null, { email: body.email.trim(), fullName: body.fullName.trim(), roleIds: body.roleIds || [] });
  return c.json(results[0], 201);
});
users.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  if (body.email) {
    const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ? AND id != ?").bind(body.email.trim(), id).first();
    if (existing) return c.json({ message: "A user with this email already exists." }, 409);
  }
  const oldUser = await c.env.DB.prepare(
    "SELECT id, email, full_name, phone, branch_id, warehouse_id, is_active FROM users WHERE id = ?"
  ).bind(id).first();
  await c.env.DB.prepare(`
    UPDATE users SET
      full_name = COALESCE(?, full_name),
      email = COALESCE(?, email),
      phone = ?,
      branch_id = ?,
      warehouse_id = ?,
      is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).bind(
    body.fullName || null,
    body.email || null,
    body.phone !== void 0 ? body.phone || null : void 0,
    body.branchId !== void 0 ? body.branchId || null : void 0,
    body.warehouseId !== void 0 ? body.warehouseId || null : void 0,
    body.isActive !== void 0 ? body.isActive ? 1 : 0 : null,
    id
  ).run();
  if (body.roleIds !== void 0) {
    await c.env.DB.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(id).run();
    if (body.roleIds.length > 0) {
      const stmts = body.roleIds.map(
        (rId) => c.env.DB.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(id, rId)
      );
      await c.env.DB.batch(stmts);
    }
  }
  const user = await c.env.DB.prepare(
    "SELECT id, email, full_name, phone, branch_id, warehouse_id, is_active FROM users WHERE id = ?"
  ).bind(id).first();
  await logAudit(c, "USER_UPDATE", "users", id, oldUser, body);
  return c.json(user);
});
users.post("/:id/change-password", async (c) => {
  const id = c.req.param("id");
  const { newPassword } = await c.req.json();
  if (!newPassword || newPassword.length < 6) {
    return c.json({ message: "Password must be at least 6 characters" }, 400);
  }
  const passwordHash = bcrypt2.hashSync(newPassword, 12);
  await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(passwordHash, id).run();
  await logAudit(c, "USER_CHANGE_PASSWORD", "users", id, null, { changed: true });
  return c.json({ success: true });
});
users.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const user = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!user) return c.json({ message: "User not found." }, 404);
  const activeOrders = await c.env.DB.prepare(
    "SELECT id FROM sales_orders WHERE created_by = ? AND status NOT IN ('PAID', 'CANCELLED') LIMIT 1"
  ).bind(id).first();
  if (activeOrders) return c.json({ message: "Cannot delete: user has active sales orders. Deactivate instead." }, 400);
  const activeTransfers = await c.env.DB.prepare(
    "SELECT id FROM transfers WHERE requested_by = ? AND status NOT IN ('COMPLETED', 'CANCELLED') LIMIT 1"
  ).bind(id).first();
  if (activeTransfers) return c.json({ message: "Cannot delete: user has active transfers. Deactivate instead." }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id),
    createAuditLogStmt(c, "USER_DELETE", "users", id, user, null)
  ]);
  return c.json({ success: true });
});
var users_default = users;

// src/routes/notifications.ts
var notifications = new Hono2();
notifications.use("/*", authMiddleware);
notifications.get("/", async (c) => {
  const userId = c.get("jwtPayload").sub;
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM notifications 
    WHERE user_id = ? OR user_id IS NULL
    ORDER BY created_at DESC LIMIT 50
  `).bind(userId).all();
  return c.json(results);
});
notifications.post("/read", async (c) => {
  const userId = c.get("jwtPayload").sub;
  await c.env.DB.prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL").bind(userId).run();
  return c.json({ success: true });
});
var notifications_default = notifications;

// src/routes/audit.ts
var audit = new Hono2();
audit.use("/*", authMiddleware, async (c, next) => {
  const payload = c.get("jwtPayload");
  if (!payload) return c.json({ message: "Unauthorized" }, 401);
  const hasAccess = payload.permissions.includes("manage_users") || payload.permissions.includes("view_reports") || payload.permissions.includes("super_admin") || payload.permissions.includes("manage_inventory") || payload.permissions.includes("manage_sales") || payload.permissions.includes("manage_purchasing");
  if (!hasAccess && payload.permissions.length > 0) {
    return c.json({ message: "Forbidden" }, 403);
  }
  await next();
});
audit.get("/", async (c) => {
  const entityType = c.req.query("entityType");
  const action = c.req.query("action");
  const actor = c.req.query("actor");
  const search = c.req.query("search");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  let sql = `
    SELECT a.*, u.full_name as actor_name, u.email as actor_email 
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE 1=1
  `;
  const params = [];
  if (entityType && entityType.trim() !== "") {
    sql += " AND a.entity_type = ?";
    params.push(entityType.trim());
  }
  if (action && action.trim() !== "") {
    sql += " AND a.action = ?";
    params.push(action.trim());
  }
  if (actor && actor.trim() !== "") {
    sql += " AND (a.actor_user_id = ? OR u.full_name LIKE ? OR u.email LIKE ?)";
    params.push(actor.trim(), `%${actor.trim()}%`, `%${actor.trim()}%`);
  }
  if (search && search.trim() !== "") {
    sql += " AND (a.action LIKE ? OR a.entity_type LIKE ? OR a.entity_id LIKE ? OR a.old_value LIKE ? OR a.new_value LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)";
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s, s, s, s);
  }
  if (startDate && startDate.trim() !== "") {
    sql += " AND a.created_at >= ?";
    params.push(startDate.trim());
  }
  if (endDate && endDate.trim() !== "") {
    sql += " AND a.created_at <= ?";
    params.push(endDate.trim());
  }
  sql += " ORDER BY a.created_at DESC LIMIT 200";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  const parsedResults = results.map((row) => {
    let oldVal = row.old_value;
    let newVal = row.new_value;
    try {
      if (oldVal && typeof oldVal === "string") oldVal = JSON.parse(oldVal);
    } catch (_) {
    }
    try {
      if (newVal && typeof newVal === "string") newVal = JSON.parse(newVal);
    } catch (_) {
    }
    return {
      ...row,
      old_value: oldVal,
      new_value: newVal
    };
  });
  return c.json(parsedResults);
});
var audit_default = audit;

// src/routes/files.ts
var files = new Hono2();
files.use("/*", authMiddleware);
files.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM files ORDER BY created_at DESC LIMIT 100").all();
  return c.json(results);
});
files.post("/", async (c) => {
  const userId = c.get("jwtPayload").sub;
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file) return c.json({ message: "No file provided" }, 400);
  const id = uuidv4();
  const ext = file.name.split(".").pop();
  const objectKey = `${id}.${ext}`;
  await c.env.STORAGE.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type }
  });
  await c.env.DB.prepare(`
    INSERT INTO files (id, file_name, file_size, mime_type, object_key, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, file.name, file.size, file.type, objectKey, userId).run();
  const { results } = await c.env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(id).all();
  return c.json(results[0], 201);
});
files.get("/:key", async (c) => {
  const key = c.req.param("key");
  const object = await c.env.STORAGE.get(key);
  if (!object) return c.json({ message: "File not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
});
var files_default = files;

// src/index.ts
var app = new Hono2();
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  exposeHeaders: ["Content-Length"],
  maxAge: 86400,
  credentials: true
}));
app.get("/", (c) => c.json({
  service: "Al Hayat ERP & WMS Backend API",
  version: "1.0.0",
  status: "active",
  environment: "production",
  healthCheck: "/api/v1/health"
}));
app.get("/api/v1/health", (c) => c.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() }));
app.route("/api/v1/auth", auth_default);
app.route("/api/v1/products", products_default);
app.route("/api/v1/inventory", inventory_default);
app.route("/api/v1/warehouses", warehouses_default);
app.route("/api/v1/branches", branches_default);
app.route("/api/v1/transfers", transfers_default);
app.route("/api/v1/purchasing", purchasing_default);
app.route("/api/v1/sales", sales_default);
app.route("/api/v1/reports", reports_default);
app.route("/api/v1/users", users_default);
app.route("/api/v1/notifications", notifications_default);
app.route("/api/v1/audit", audit_default);
app.route("/api/v1/files", files_default);
app.onError((err, c) => {
  const errorPayload = {
    level: "error",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    service: "al-hayat-api",
    path: c.req.url,
    method: c.req.method,
    error: err.message,
    name: err.name,
    stack: err.stack,
    headers: {
      userAgent: c.req.header("user-agent"),
      ip: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")
    }
  };
  console.error(JSON.stringify(errorPayload));
  return c.json(
    {
      error: err.message || "Internal Server Error",
      status: 500
    },
    500
  );
});
app.notFound((c) => {
  console.warn(
    JSON.stringify({
      level: "warn",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      service: "al-hayat-api",
      event: "NOT_FOUND",
      path: c.req.url,
      method: c.req.method
    })
  );
  return c.json({ error: "Route not found", status: 404 }, 404);
});
var index_default = app;
export {
  index_default as default
};
/*! Bundled license information:

bcryptjs/dist/bcrypt.js:
  (**
   * @license bcrypt.js (c) 2013 Daniel Wirtz <dcode@dcode.io>
   * Released under the Apache License, Version 2.0
   * see: https://github.com/dcodeIO/bcrypt.js for details
   *)
*/
//# sourceMappingURL=index.js.map
