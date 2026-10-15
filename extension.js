const vscode = require('vscode');

const OPS = {
  SS:   { n: 'push',    a: 'num', d: 'Stack: положить число в стек' },
  SLS:  { n: 'dup',     d: 'Stack: дублировать верх стека' },
  SLT:  { n: 'swap',    d: 'Stack: поменять местами два верхних' },
  SLL:  { n: 'drop',    d: 'Stack: убрать верх стека' },
  STS:  { n: 'copy',    a: 'num', d: 'Stack: скопировать n-й элемент наверх' },
  STL:  { n: 'slide',   a: 'num', d: 'Stack: убрать n элементов под верхним' },

  TSSS: { n: 'add',     d: 'Arithmetic: a + b' },
  TSST: { n: 'sub',     d: 'Arithmetic: a - b' },
  TSSL: { n: 'mul',     d: 'Arithmetic: a * b' },
  TSTS: { n: 'div',     d: 'Arithmetic: a / b (целочисленное)' },
  TSTT: { n: 'mod',     d: 'Arithmetic: a % b' },
  TTS:  { n: 'store',   d: 'Heap: heap[a] = b' },
  TTT:  { n: 'load',    d: 'Heap: положить heap[a] в стек' },

  LSS:  { n: 'label',   a: 'lbl', d: 'Flow: метка' },
  LST:  { n: 'call',    a: 'lbl', d: 'Flow: вызов подпрограммы' },
  LSL:  { n: 'jmp',     a: 'lbl', d: 'Flow: безусловный переход' },
  LTS:  { n: 'jz',      a: 'lbl', d: 'Flow: переход, если верх стека == 0' },
  LTT:  { n: 'jn',      a: 'lbl', d: 'Flow: переход, если верх стека < 0' },
  LTL:  { n: 'ret',     d: 'Flow: возврат из подпрограммы' },
  LLL:  { n: 'end',     d: 'Flow: конец программы' },

  TLSS: { n: 'printc',  d: 'I/O: вывести символ' },
  TLST: { n: 'printn',  d: 'I/O: вывести число' },
  TLTS: { n: 'readc',   d: 'I/O: прочитать символ' },
  TLTT: { n: 'readn',   d: 'I/O: прочитать число' }
};

function parse(text) {
  const toks = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === ' ') toks.push({ k: 'S', i });
    else if (c === '\t') toks.push({ k: 'T', i });
    else if (c === '\n') toks.push({ k: 'L', i });
  }

  const instrs = [];
  let p = 0;
  while (p < toks.length) {
    const first = p;
    let code = '';
    let def = null;
    while (p < toks.length && code.length < 4) {
      code += toks[p++].k;
      if (OPS[code]) { def = OPS[code]; break; }
    }
    if (!def) {
      instrs.push({ op: [toks[first]], arg: [], text: '??? неизвестная команда', desc: '', error: true });
      if (p >= toks.length) break;
      p = first + 1;
      continue;
    }

    const ins = { op: toks.slice(first, p), arg: [], text: def.n, desc: def.d, error: false, name: def.n };

    if (def.a) {
      const s = p;
      while (p < toks.length && toks[p].k !== 'L') p++;
      if (p >= toks.length) {
        ins.arg = toks.slice(s, p);
        ins.text = def.n + ' <нет завершающего LF>';
        ins.error = true;
        instrs.push(ins);
        break;
      }
      const bits = toks.slice(s, p);
      ins.arg = toks.slice(s, p + 1);
      p++;

      if (def.a === 'num') {
        if (bits.length === 0) {
          ins.text = def.n + ' <пустое число>';
          ins.error = true;
        } else {
          const neg = bits[0].k === 'T';
          const bin = bits.slice(1).map(b => (b.k === 'T' ? '1' : '0')).join('') || '0';
          let v = BigInt('0b' + bin);
          if (neg) v = -v;
          ins.value = v;
          ins.text = def.n + ' ' + v.toString();
          if (def.n === 'push' && v >= 32n && v <= 126n) {
            ins.text += " '" + String.fromCharCode(Number(v)) + "'";
          }
        }
      } else {
        const name = 'L' + (bits.map(b => (b.k === 'T' ? '1' : '0')).join('') || '∅');
        ins.label = name;
        ins.text = def.n + ' ' + name;
      }
    }
    instrs.push(ins);
  }
  return instrs;
}

const COLORS = {
  S: 'rgba(80, 160, 255, 0.30)',   // space
  T: 'rgba(255, 170, 60, 0.38)',   // tab
  L: 'rgba(90, 200, 120, 0.95)'    // LF
};

const COLORS_DIM = {
  S: 'rgba(80, 160, 255, 0.12)',
  T: 'rgba(255, 170, 60, 0.15)',
  L: 'rgba(90, 200, 120, 0.45)'
};

const ERR_BG = 'rgba(255, 60, 60, 0.45)';
const ERR_FG = '#ff5555';

const types = {};
function makeTypes() {
  for (const k of ['S', 'T']) {
    types['o' + k] = vscode.window.createTextEditorDecorationType({ backgroundColor: COLORS[k] });
    types['a' + k] = vscode.window.createTextEditorDecorationType({ backgroundColor: COLORS_DIM[k] });
    types['E' + k] = vscode.window.createTextEditorDecorationType({ backgroundColor: ERR_BG });
  }
  const nl = (color) => vscode.window.createTextEditorDecorationType({
    before: { contentText: '↵', color }
  });
  types.oL = nl(COLORS.L);
  types.aL = nl(COLORS_DIM.L);
  types.EL = nl(ERR_FG);
  types.mnemonic = vscode.window.createTextEditorDecorationType({});
}

function update(editor) {
  if (!editor || editor.document.languageId !== 'whitespace') return;
  const cfg = vscode.workspace.getConfiguration('whitespaceLang');
  const showMn = cfg.get('showMnemonics', true);
  const showNl = cfg.get('showNewlineMarker', true);

  const doc = editor.document;
  const instrs = parse(doc.getText());
  const ranges = {};
  const add = (key, r) => (ranges[key] || (ranges[key] = [])).push(r);
  const lines = new Map();

  for (const ins of instrs) {
    const mark = (toks, role) => {
      for (const t of toks) {
        const pos = doc.positionAt(t.i);
        const key = (ins.error ? 'E' : role) + t.k;
        if (t.k === 'L') {
          if (showNl || ins.error) add(key, new vscode.Range(pos, pos));
        } else {
          add(key, new vscode.Range(pos, doc.positionAt(t.i + 1)));
        }
      }
    };
    mark(ins.op, 'o');
    mark(ins.arg, 'a');

    const line = doc.positionAt(ins.op[0].i).line;
    const entry = lines.get(line) || { texts: [], descs: [], error: false };
    entry.texts.push(ins.text);
    if (ins.desc) entry.descs.push('`' + ins.text + '` — ' + ins.desc);
    entry.error = entry.error || ins.error;
    lines.set(line, entry);
  }

  for (const key of Object.keys(types)) {
    if (key === 'mnemonic') continue;
    editor.setDecorations(types[key], ranges[key] || []);
  }

  const mnOpts = [];
  if (showMn) {
    for (const [line, e] of lines) {
      const end = doc.lineAt(line).range.end;
      mnOpts.push({
        range: new vscode.Range(end, end),
        hoverMessage: e.descs.length ? new vscode.MarkdownString(e.descs.join('\n\n')) : undefined,
        renderOptions: {
          after: {
            contentText: '  ⟶ ' + e.texts.join(' │ '),
            color: e.error ? ERR_FG : new vscode.ThemeColor('editorCodeLens.foreground'),
            fontStyle: 'italic'
          }
        }
      });
    }
  }
  editor.setDecorations(types.mnemonic, mnOpts);
}

function refreshAll() {
  vscode.window.visibleTextEditors.forEach(update);
}

function disassemble(doc) {
  const out = [];
  for (const ins of parse(doc.getText())) {
    if (ins.error) { out.push('; ОШИБКА: ' + ins.text); continue; }
    out.push((ins.name === 'label' ? '' : '    ') + ins.text);
  }
  return out.join('\n');
}

function activate(context) {
  makeTypes();
  refreshAll();

  let timer;
  const schedule = (editor) => {
    clearTimeout(timer);
    timer = setTimeout(() => update(editor), 120);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(e => update(e)),
    vscode.window.onDidChangeVisibleTextEditors(refreshAll),
    vscode.workspace.onDidChangeTextDocument(ev => {
      const ed = vscode.window.visibleTextEditors.find(e => e.document === ev.document);
      if (ed) schedule(ed);
    }),
    vscode.workspace.onDidChangeConfiguration(ev => {
      if (ev.affectsConfiguration('whitespaceLang')) refreshAll();
    }),
    vscode.commands.registerCommand('whitespaceLang.toggleMnemonics', async () => {
      const cfg = vscode.workspace.getConfiguration('whitespaceLang');
      await cfg.update('showMnemonics', !cfg.get('showMnemonics', true), vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('whitespaceLang.disassemble', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      const d = await vscode.workspace.openTextDocument({ content: disassemble(ed.document), language: 'plaintext' });
      vscode.window.showTextDocument(d, vscode.ViewColumn.Beside);
    }),
    { dispose: () => Object.values(types).forEach(t => t.dispose()) }
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
