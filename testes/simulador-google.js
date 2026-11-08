/* Simulador dos serviços do Google Apps Script usados por apps-script/Codigo.gs.
 * Serve só para testes neste computador: carrega o Codigo.gs no navegador e o faz funcionar
 * com uma "planilha" em memória (guardada no localStorage, se SIMULADOR.persistir for true). */
(function () {
  "use strict";
  var G = window;

  /* ---------- SHA-256 e HMAC síncronos ---------- */
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256Bytes(bytes) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var m = bytes.map(function (b) { return b & 255; }), l = m.length * 8;
    m.push(0x80);
    while (m.length % 64 !== 56) m.push(0);
    for (var s = 56; s >= 0; s -= 8) m.push(s >= 32 ? Math.floor(l / Math.pow(2, s)) & 255 : (l >>> s) & 255);
    var w = new Array(64);
    for (var i = 0; i < m.length; i += 64) {
      for (var t = 0; t < 16; t++) w[t] = (m[i + 4 * t] << 24) | (m[i + 4 * t + 1] << 16) | (m[i + 4 * t + 2] << 8) | m[i + 4 * t + 3];
      for (t = 16; t < 64; t++) {
        var a0 = w[t - 15], a1 = w[t - 2];
        var s0 = ((a0 >>> 7) | (a0 << 25)) ^ ((a0 >>> 18) | (a0 << 14)) ^ (a0 >>> 3);
        var s1 = ((a1 >>> 17) | (a1 << 15)) ^ ((a1 >>> 19) | (a1 << 13)) ^ (a1 >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h = [h[0] + a, h[1] + b, h[2] + c, h[3] + d, h[4] + e, h[5] + f, h[6] + g, h[7] + hh].map(function (x) { return x | 0; });
    }
    var out = [];
    h.forEach(function (x) { out.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255); });
    return out;
  }
  function utf8(s) { return Array.prototype.slice.call(new TextEncoder().encode(String(s))); }
  function assinado(b) { return b.map(function (x) { x &= 255; return x > 127 ? x - 256 : x; }); }
  function bytesDe(v) { return typeof v === "string" ? utf8(v) : v.map(function (x) { return x & 255; }); }
  function hmac(valor, chave) {
    var k = bytesDe(chave), v = bytesDe(valor);
    if (k.length > 64) k = sha256Bytes(k);
    while (k.length < 64) k.push(0);
    var ip = k.map(function (x) { return x ^ 0x36; }), op = k.map(function (x) { return x ^ 0x5c; });
    return assinado(sha256Bytes(op.concat(sha256Bytes(ip.concat(v)))));
  }

  /* ---------- Utilities ---------- */
  function partesData(data, fuso) {
    var p = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(data).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  G.Utilities = {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest: function (alg, texto) { return assinado(sha256Bytes(utf8(texto))); },
    computeHmacSha256Signature: hmac,
    getUuid: function () { return crypto.randomUUID(); },
    base64Encode: function (s) { var b = utf8(s), t = ""; b.forEach(function (x) { t += String.fromCharCode(x); }); return btoa(t); },
    newBlob: function (s) { return { getBytes: function () { return assinado(utf8(s)); } }; },
    formatDate: function (data, fuso, formato) {
      var p = partesData(data, fuso), saida = "", i = 0;
      while (i < formato.length) {
        if (formato[i] === "'") { var j = formato.indexOf("'", i + 1); saida += formato.slice(i + 1, j); i = j + 1; continue; }
        var tok = ["yyyy", "MM", "dd", "HH", "mm", "ss"].filter(function (t) { return formato.substr(i, t.length) === t; })[0];
        if (tok) { saida += { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second }[tok]; i += tok.length; }
        else { saida += formato[i]; i++; }
      }
      return saida;
    }
  };

  /* ---------- armazenamento simulado ---------- */
  var CHAVE = "simulador-google-v1";
  var mundo = { abas: {}, props: {}, cache: {} };
  var SIM = G.SIMULADOR = G.SIMULADOR || {};
  SIM.persistir = !!SIM.persistir;
  SIM.github = [];
  SIM.githubFalha = false;
  SIM.relogio = null; // número de milissegundos a somar ao relógio (para testar datas)
  function salvar() { if (SIM.persistir) try { localStorage.setItem(CHAVE, JSON.stringify(mundo)); } catch (e) {} }
  if (SIM.persistir) try { var lido = JSON.parse(localStorage.getItem(CHAVE)); if (lido) mundo = lido; } catch (e) {}
  SIM.zerar = function () { mundo = { abas: {}, props: {}, cache: {} }; salvar(); };
  SIM.mundo = function () { return mundo; };
  SIM.salvar = salvar;

  /* Como a planilha real: apóstrofo inicial força texto; texto que parece número vira número. */
  function guardar(v) {
    if (typeof v === "string") {
      if (v[0] === "'") return v.slice(1);
      if (v !== "" && !isNaN(Number(v))) return Number(v);
      if (v[0] === "=") throw new Error("SIMULADOR: fórmula gravada sem proteção: " + v);
    }
    return v;
  }
  function Aba(nome) { this.nome = nome; }
  Aba.prototype = {
    dados: function () { return mundo.abas[this.nome]; },
    getName: function () { return this.nome; },
    getLastRow: function () { return this.dados().length; },
    appendRow: function (l) { this.dados().push(l.map(guardar)); },
    deleteRow: function (n) { this.dados().splice(n - 1, 1); },
    setFrozenRows: function () {},
    protect: function () { var p = { setWarningOnly: function () { return p; }, setDescription: function () { return p; } }; return p; },
    getProtections: function () { return []; },
    getDataRange: function () { var d = this.dados(); return { getValues: function () { return d.map(function (l) { return l.slice(); }); } }; },
    getRange: function (linha, col, nl, nc) {
      var d = this.dados();
      return {
        setValues: function (vals) {
          for (var i = 0; i < nl; i++) { while (d.length < linha + i) d.push([]); for (var j = 0; j < nc; j++) d[linha - 1 + i][col - 1 + j] = guardar(vals[i][j]); }
        },
        getValues: function () { var s = []; for (var i = 0; i < nl; i++) s.push(d[linha - 1 + i].slice(col - 1, col - 1 + nc)); return s; }
      };
    }
  };
  var planilha = {
    getId: function () { return "planilha-simulada"; },
    getSheetByName: function (n) { return mundo.abas[n] ? new Aba(n) : null; },
    insertSheet: function (n) { mundo.abas[n] = []; return new Aba(n); },
    getSheets: function () { return Object.keys(mundo.abas).map(function (n) { return new Aba(n); }); },
    deleteSheet: function (a) { delete mundo.abas[a.getName()]; }
  };
  G.SpreadsheetApp = { getActiveSpreadsheet: function () { return planilha; }, openById: function () { return planilha; }, ProtectionType: { SHEET: "SHEET" } };
  G.PropertiesService = { getScriptProperties: function () { return {
    getProperty: function (k) { return k in mundo.props ? mundo.props[k] : null; },
    setProperty: function (k, v) { mundo.props[k] = String(v); },
    deleteProperty: function (k) { delete mundo.props[k]; }
  }; } };
  G.CacheService = { getScriptCache: function () { return {
    get: function (k) { var x = mundo.cache[k]; if (!x || x.expira < Date.now()) return null; return x.valor; },
    put: function (k, v, s) { mundo.cache[k] = { valor: String(v), expira: Date.now() + (s || 600) * 1000 }; },
    remove: function (k) { delete mundo.cache[k]; }
  }; } };
  G.LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
  G.ContentService = { MimeType: { JSON: "JSON" }, createTextOutput: function (s) { return { setMimeType: function () { return this; }, getContent: function () { return s; } }; } };
  G.UrlFetchApp = { fetch: function (url, op) {
    SIM.github.push({ url: url, op: op });
    var cod = SIM.githubFalha ? 503 : 201;
    return { getResponseCode: function () { return cod; }, getContentText: function () { return "{}"; } };
  } };
  var gatilhos = [];
  G.ScriptApp = {
    getProjectTriggers: function () { return gatilhos.slice(); },
    deleteTrigger: function (t) { gatilhos.splice(gatilhos.indexOf(t), 1); },
    newTrigger: function (f) { var t = { getHandlerFunction: function () { return f; } }; var c = { timeBased: function () { return c; }, everyMinutes: function () { return c; }, create: function () { gatilhos.push(t); return t; } }; return c; }
  };
  G.Logger = { log: function (m) { console.log("[Apps Script]", m); } };

  /* Relógio ajustável: SIMULADOR.relogio (ms) adianta ou atrasa o "agora" do servidor simulado. */
  var DataOriginal = Date;
  function DataSim(a, b, c, d, e, f, g) {
    if (!(this instanceof DataSim)) return new DataOriginal(DataSim.now()).toString();
    if (arguments.length === 0) return new DataOriginal(DataSim.now());
    return new (Function.prototype.bind.apply(DataOriginal, [null].concat(Array.prototype.slice.call(arguments))))();
  }
  DataSim.now = function () { return DataOriginal.now() + (SIM.relogio || 0); };
  DataSim.parse = DataOriginal.parse; DataSim.UTC = DataOriginal.UTC; DataSim.prototype = DataOriginal.prototype;

  /* ---------- carrega o servidor (apps-script/Codigo.gs) ---------- */
  var base = (document.currentScript && document.currentScript.src || location.href).replace(/testes\/[^\/]*$/, "");
  var xhr = new XMLHttpRequest();
  xhr.open("GET", base + "apps-script/Codigo.gs?" + DataOriginal.now(), false);
  xhr.send();
  // O servidor roda com o relógio simulado; a página (navegador) continua com o real.
  (0, eval)("(function(Date){" + xhr.responseText + "\n;['doPost','doGet','configurar','tarefaPeriodica','executarAutomaticos','sortear','canon','sha256','verificarCadeia','hashSenha','conferirSenha'].forEach(function(n){ window['GAS_' + n] = eval(n); });})")(DataSim);

  SIM.chamar = function (pedido) {
    var r = JSON.parse(G.GAS_doPost({ postData: { contents: JSON.stringify(pedido) } }).getContent());
    salvar();
    return r;
  };
  SIM.tarefaPeriodica = function () { G.GAS_tarefaPeriodica(); salvar(); };
  if (!mundo.props.PLANILHA_ID) { G.GAS_configurar(); salvar(); }
  // Na página de teste da interface, o sorteio automático também roda de tempos em tempos.
  if (SIM.persistir) setInterval(SIM.tarefaPeriodica, 20000);
})();
