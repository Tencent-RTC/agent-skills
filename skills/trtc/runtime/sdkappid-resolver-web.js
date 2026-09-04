// sdkappid-resolver-web.js — Structured (Babel/Vue AST) SDKAppID adapter.
//
// Cold bundle entry: compiled to sdkappid-resolver-web.cjs by build-telemetry.js.
// This file is NEVER imported by telemetry.cjs — the hot bundle must not include
// Babel or Vue packages.
//
// Contract: extract({ source, relativePath, ext, byteLength })
//   → { status: 'ok', candidates: [] }   on success
//   → { status: 'invalid', candidates: [] } on any parse/traversal error

import { parse as babelParse } from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { parse as parseTemplate } from '@vue/compiler-dom';

// Handle both ESM and CommonJS-wrapped traverse exports
const traverse = typeof _traverse === 'function' ? _traverse : _traverse.default;

export const WEB_ADAPTER_VERSION = '18.4.0';

// ── Constants ─────────────────────────────────────────────────────────────────

const R05_PACKAGES = ['@tencentcloud/roomkit-web-vue3', '@tencentcloud/roomkit-web-react'];
// Authority: skills/trtc-ai-realtime-interpreter/.../useAiInterpreter.ts line 2
const R07_PACKAGES = ['trtc-sdk-v5'];

// R18 is deliberately a narrow fallback for projects whose SDKAppID is kept
// in a project-owned config object rather than in one of the product-specific
// calls above.  It is AST/scope based: raw proximity or text matching is not
// sufficient, and comments/string literals never create context.
const GENERIC_SDKAPPID_FIELDS = new Set([
  'sdkAppId', 'SDKAppID', 'sdkappid', 'SDKAPPID', 'SDK_APP_ID', 'sdk_app_id',
]);
const CONTEXT_MEMBER_NAMES = new Set(['init', 'login', 'enterRoom', 'create', 'start']);
// Match package-segment boundaries so lookalikes such as `nottrtc-utils` or
// `@vendor/roomkitten` cannot authorize an otherwise generic config object.
const CONTEXT_IMPORT_RE = /(?:^|[\/@-])(?:trtc|tui(?:kit|call|live|room)|roomkit|chat-uikit)(?:[\/@.\-]|$)/i;
const CONTEXT_IDENTIFIER_RE = /^(?:trtc|tuikit|tuicallkit|tuilivekit|tuiroomkit|roomkit|loginstore|uselogin(?:store|state))(?:[A-Za-z0-9_]*)$/i;
const STRONG_CONFIG_NAME_RE = /^(?:trtc|rtc|tui)(?:config|options|settings)?$/i;
const GENERIC_CONFIG_NAME_RE = /(?:config|options|settings)$/i;
const GENERIC_CONTEXT_WINDOW_LINES = 8;

// ── SDKAppID validation (mirrors validSdkAppId in sdkappid-resolver.js) ───────

function validSdkAppId(value) {
  const text = String(value ?? '').trim();
  if (!/^[0-9]+$/.test(text) || /^0+$/.test(text)) return null;
  if (/PLACEHOLDER|x{3,}|your|demo/i.test(text)) return null;
  return text;
}

// ── Babel plugin/sourceType matrix ───────────────────────────────────────────

function babelOptions(ext) {
  switch (ext) {
    case '.tsx': return { plugins: ['typescript', 'jsx'], sourceType: 'module' };
    case '.ts':  return { plugins: ['typescript'], sourceType: 'module' };
    case '.jsx': return { plugins: ['jsx'], sourceType: 'module' };
    default:     return { plugins: ['jsx'], sourceType: 'module', allowImportExportEverywhere: true, strictMode: false };
  }
}

// ── Scope-aware value extraction ──────────────────────────────────────────────

/**
 * Resolve a node (NumericLiteral or Identifier) to its SDKAppID value using
 * Babel scope analysis. Identifiers must be `const` declarations initialized
 * to a numeric literal, with no writes in the enclosing scope.
 */
function resolveValueScoped(node, callPath) {
  if (t.isNumericLiteral(node)) return validSdkAppId(String(node.value));
  if (!t.isIdentifier(node)) return null;
  const binding = callPath.scope.getBinding(node.name);
  if (!binding || !binding.constant) return null;
  if (!t.isVariableDeclarator(binding.path.node)) return null;
  const varDecl = binding.path.parent;
  if (!t.isVariableDeclaration(varDecl) || varDecl.kind !== 'const') return null;
  const init = binding.path.node.init;
  if (!t.isNumericLiteral(init)) return null;
  return validSdkAppId(String(init.value));
}

/**
 * Extract the value of a named property from an ObjectExpression's top-level
 * properties using scope-aware binding lookup.
 * Does NOT recurse into nested objects.
 */
function extractFromObjScoped(objNode, fieldName, callPath) {
  for (const prop of objNode.properties) {
    if (!t.isObjectProperty(prop)) continue;
    const keyName = t.isIdentifier(prop.key) ? prop.key.name :
                    t.isStringLiteral(prop.key) ? prop.key.value : null;
    if (keyName !== fieldName) continue;

    if (t.isNumericLiteral(prop.value)) {
      return validSdkAppId(String(prop.value.value));
    }

    // Shorthand { SDKAppID } or named { sdkAppId: someVar }
    const identName = prop.shorthand
      ? (t.isIdentifier(prop.key) ? prop.key.name : null)
      : (t.isIdentifier(prop.value) ? prop.value.name : null);
    if (!identName) return null;

    const binding = callPath.scope.getBinding(identName);
    if (!binding || !binding.constant) return null;
    if (!t.isVariableDeclarator(binding.path.node)) return null;
    const varDecl = binding.path.parent;
    if (!t.isVariableDeclaration(varDecl) || varDecl.kind !== 'const') return null;
    const init = binding.path.node.init;
    if (!t.isNumericLiteral(init)) return null;
    return validSdkAppId(String(init.value));
  }
  return null;
}

/**
 * Check whether a Babel binding is a destructured 'login' from a hookName() call.
 * Handles: const { login } = hookName()  and  const { login: alias } = hookName()
 *
 * NOTE: scope.getBinding() returns the binding's VariableDeclarator path, NOT the
 * ObjectProperty. The localName is the identifier we looked up (the value/alias).
 */
function isLoginFromHook(binding, hookName, localName) {
  // Binding must be constant — no reassignment after destructuring
  if (!binding?.constant) return false;
  const bNode = binding.path.node;
  // Must be VariableDeclarator with ObjectPattern id and hookName() call init
  if (!t.isVariableDeclarator(bNode)) return false;
  if (!t.isObjectPattern(bNode.id)) return false;
  const init = bNode.init;
  if (!t.isCallExpression(init) || !t.isIdentifier(init.callee) || init.callee.name !== hookName) return false;
  // Verify the specific property being bound has key 'login' and value localName
  return bNode.id.properties.some(prop => {
    if (!t.isObjectProperty(prop)) return false;
    const keyName = t.isIdentifier(prop.key) ? prop.key.name : null;
    if (keyName !== 'login') return false;
    const valueName = t.isIdentifier(prop.value) ? prop.value.name : null;
    return valueName === localName;
  });
}

// ── Script const bindings for Vue template lookup ─────────────────────────────

/**
 * Build a Map<name, sdkAppId> for top-level const numeric bindings in a script block.
 * Uses Babel's Program scope so binding.constant correctly reflects any writes
 * (even `const x = 1; x = 2` would show constant=false).
 * Used only for Vue template `:SDKAppID="varName"` binding lookup.
 */
function buildScriptConstBindings(ast) {
  const bindings = new Map();
  traverse(ast, {
    Program(path) {
      for (const [name, binding] of Object.entries(path.scope.bindings)) {
        if (!binding.constant) continue;
        if (!t.isVariableDeclarator(binding.path.node)) continue;
        const varDecl = binding.path.parent;
        if (!t.isVariableDeclaration(varDecl) || varDecl.kind !== 'const') continue;
        const init = binding.path.node.init;
        if (!t.isNumericLiteral(init)) continue;
        const val = validSdkAppId(String(init.value));
        if (val) bindings.set(name, val);
      }
    },
  });
  return bindings;
}

function isConstBinding(binding) {
  if (!binding?.constant || !t.isVariableDeclarator(binding.path?.node)) return false;
  const declaration = binding.path.parent;
  return t.isVariableDeclaration(declaration) && declaration.kind === 'const';
}

function nodeLine(node) {
  return Number.isInteger(node?.loc?.start?.line) ? node.loc.start.line : null;
}

function scopeAnchor(path) {
  let current = path?.scope?.path || path;
  while (current && !current.isProgram?.() && !current.isFunction?.()) current = current.parentPath;
  return current?.node || null;
}

function addContextLine(contextLines, node, path) {
  const start = node?.loc?.start?.line;
  const end = node?.loc?.end?.line ?? start;
  if (!Number.isInteger(start)) return;
  const anchor = scopeAnchor(path);
  for (let line = start; line <= end; line++) contextLines.push({ line, anchor });
}

function isContextIdentifier(name) {
  return CONTEXT_IDENTIFIER_RE.test(String(name || '')) ||
    /^(?:TRTC|TUIKit|TUICallKit|TUILiveKit|TUIRoomKit|LoginStore)/.test(String(name || ''));
}

/**
 * Collect executable TRTC-ish context lines. Babel's AST has no comment/text
 * nodes here, so a mention in documentation or a string cannot authorize a
 * generic config candidate. Import declarations are explicitly included as
 * executable provenance because the package source is an actual dependency.
 */
function collectGenericContextLines(ast) {
  const lines = [];
  traverse(ast, {
    ImportDeclaration(path) {
      if (CONTEXT_IMPORT_RE.test(String(path.node.source?.value || ''))) addContextLine(lines, path.node, path);
    },
    CallExpression(path) {
      const callee = path.node.callee;
      if (t.isIdentifier(callee) && isContextIdentifier(callee.name)) addContextLine(lines, callee, path);
      if (t.isMemberExpression(callee)) {
        const object = callee.object;
        const property = !callee.computed && t.isIdentifier(callee.property) ? callee.property.name : null;
        if (t.isIdentifier(object) && isContextIdentifier(object.name)) addContextLine(lines, callee, path);
        if (property && (CONTEXT_MEMBER_NAMES.has(property) || isContextIdentifier(property)) &&
            t.isIdentifier(object) && isContextIdentifier(object.name)) addContextLine(lines, callee, path);
      }
    },
    MemberExpression(path) {
      const object = path.node.object;
      const property = !path.node.computed && t.isIdentifier(path.node.property) ? path.node.property.name : null;
      if (t.isIdentifier(object) && isContextIdentifier(object.name)) addContextLine(lines, path.node, path);
      if (property && isContextIdentifier(property)) addContextLine(lines, path.node, path);
    },
    Identifier(path) {
      if (path.isReferencedIdentifier() && isContextIdentifier(path.node.name)) addContextLine(lines, path.node, path);
    },
    VariableDeclarator(path) {
      // A project-owned `trtcClient`/`tuiConfig` declaration is useful context
      // even before its first reference. Generic `config` is not accepted here.
      if (t.isIdentifier(path.node.id) && isContextIdentifier(path.node.id.name)) {
        addContextLine(lines, path.node.id, path);
      }
    },
  });
  return lines;
}

function hasNearbyGenericContext(node, contextLines, path) {
  const line = nodeLine(node);
  if (!line) return false;
  const anchor = scopeAnchor(path);
  for (const context of contextLines) {
    if (context.anchor === anchor && Math.abs(context.line - line) <= GENERIC_CONTEXT_WINDOW_LINES) return true;
  }
  return false;
}

function isStrongConfigName(name) {
  return STRONG_CONFIG_NAME_RE.test(String(name || ''));
}

function genericCandidate(relativePath, value, fieldName, node) {
  return {
    sdkappid: value,
    rule: 'R18',
    source_type: 'literal_config',
    source_path_hint: relativePath,
    matched_field: fieldName,
  };
}

function runR18(ast, relativePath, existingCandidates = []) {
  const candidates = [];
  const knownValues = new Set(existingCandidates.map((candidate) => candidate?.sdkappid).filter(Boolean));
  const seenValues = new Set(knownValues);
  const contextLines = collectGenericContextLines(ast);

  function shouldAccept(ownerName, node, currentPath) {
    return isStrongConfigName(ownerName) ||
      GENERIC_CONFIG_NAME_RE.test(String(ownerName || '')) && hasNearbyGenericContext(node, contextLines, currentPath);
  }

  function addObjectCandidates(objNode, ownerName, currentPath) {
    if (!shouldAccept(ownerName, objNode, currentPath)) return;
    for (const prop of objNode.properties || []) {
      if (!t.isObjectProperty(prop)) continue;
      const keyName = t.isIdentifier(prop.key) ? prop.key.name :
        (t.isStringLiteral(prop.key) ? prop.key.value : null);
      if (!GENERIC_SDKAPPID_FIELDS.has(keyName)) continue;
      const value = resolveValueScoped(prop.value, currentPath);
      if (value && !seenValues.has(value)) {
        seenValues.add(value);
        candidates.push(genericCandidate(relativePath, value, keyName, prop));
      }
    }
  }

  traverse(ast, {
    VariableDeclarator(path) {
      const { id, init } = path.node;
      if (!t.isIdentifier(id)) return;
      const binding = path.scope.getBinding(id.name);
      if (!isConstBinding(binding)) return;
      if (t.isObjectExpression(init)) {
        addObjectCandidates(init, id.name, path);
      }
    },
    AssignmentExpression(path) {
      if (path.node.operator !== '=' || !t.isMemberExpression(path.node.left)) return;
      const left = path.node.left;
      const object = left.object;
      const fieldName = !left.computed && t.isIdentifier(left.property) ? left.property.name :
        (left.computed && t.isStringLiteral(left.property) ? left.property.value : null);
      if (!t.isIdentifier(object) || !GENERIC_SDKAPPID_FIELDS.has(fieldName)) return;
      const binding = path.scope.getBinding(object.name);
      if (!isConstBinding(binding)) return;
      if (!shouldAccept(object.name, path.node, path)) return;
      const value = resolveValueScoped(path.node.right, path);
      if (value && !seenValues.has(value)) {
        seenValues.add(value);
        candidates.push(genericCandidate(relativePath, value, fieldName, path.node));
      }
    },
  });
  return candidates;
}

// ── Rule implementations ──────────────────────────────────────────────────────

function runR01(ast, relativePath) {
  const candidates = [];
  traverse(ast, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      if (
        !t.isMemberExpression(callee) ||
        !t.isIdentifier(callee.object) || callee.object.name !== 'TUIKit' ||
        !t.isIdentifier(callee.property) || callee.property.name !== 'init'
      ) return;
      if (!args.length || !t.isObjectExpression(args[0])) return;
      const val = extractFromObjScoped(args[0], 'SDKAppID', path);
      if (val) candidates.push({ sdkappid: val, rule: 'R01', source_type: 'uikit_binding', source_path_hint: relativePath, matched_field: 'SDKAppID' });
    },
  });
  return candidates;
}

function runR02_template(templateSource, filename, scriptBindings) {
  let templateAst;
  try {
    templateAst = parseTemplate(templateSource, {
      filename,
      onError: () => { throw new Error('template parse error'); },
    });
  } catch {
    return { status: 'invalid', candidates: [] };
  }
  const candidates = [];
  walkTemplateNodes(templateAst.children, candidates, scriptBindings);
  return { status: 'ok', candidates };
}

function walkTemplateNodes(nodes, candidates, scriptBindings) {
  for (const node of nodes) {
    if (node.type === 1 /* ELEMENT */ && node.tag === 'TUIKit') {
      for (const prop of node.props || []) {
        // DirectiveNode (type 7) with bind name and SDKAppID arg
        if (prop.type !== 7 || prop.name !== 'bind' || prop.arg?.content !== 'SDKAppID') continue;
        const raw = prop.exp?.content?.trim();
        if (!raw) continue;
        // Literal or identifier lookup in script bindings
        const val = validSdkAppId(raw) ||
          (/^[A-Za-z_$][\w$]*$/.test(raw) ? (scriptBindings?.get(raw) ?? null) : null);
        if (val) candidates.push({ sdkappid: val, rule: 'R02', source_type: 'uikit_binding', source_path_hint: null, matched_field: 'SDKAppID' });
      }
    }
    if (node.children?.length) walkTemplateNodes(node.children, candidates, scriptBindings);
  }
}

function runR03(ast, relativePath) {
  const candidates = [];
  traverse(ast, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      if (!args.length || !t.isObjectExpression(args[0])) return;
      let isMatch = false;

      // Chained: useLoginStore().login(...)
      if (
        t.isMemberExpression(callee) &&
        t.isCallExpression(callee.object) &&
        t.isIdentifier(callee.object.callee) && callee.object.callee.name === 'useLoginStore' &&
        t.isIdentifier(callee.property) && callee.property.name === 'login'
      ) {
        isMatch = true;
      }

      // Destructured: login(...) where binding comes from useLoginStore()
      if (!isMatch && t.isIdentifier(callee)) {
        const binding = path.scope.getBinding(callee.name);
        if (binding && isLoginFromHook(binding, 'useLoginStore', callee.name)) isMatch = true;
      }

      if (!isMatch) return;
      const val = extractFromObjScoped(args[0], 'sdkAppID', path);
      if (val) candidates.push({ sdkappid: val, rule: 'R03', source_type: 'runtime_call', source_path_hint: relativePath, matched_field: 'sdkAppID' });
    },
  });
  return candidates;
}

function runR04(ast, relativePath) {
  const candidates = [];
  traverse(ast, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      if (
        !t.isMemberExpression(callee) ||
        !t.isMemberExpression(callee.object) ||
        !t.isIdentifier(callee.object.object) || callee.object.object.name !== 'LoginStore' ||
        !t.isIdentifier(callee.object.property) || callee.object.property.name !== 'shared' ||
        !t.isIdentifier(callee.property) || callee.property.name !== 'login' ||
        args.length < 2
      ) return;
      const val = resolveValueScoped(args[1], path);
      if (val) candidates.push({ sdkappid: val, rule: 'R04', source_type: 'runtime_call', source_path_hint: relativePath, matched_field: '(positional arg 2)' });
    },
  });
  return candidates;
}

function runR05(ast, relativePath) {
  const candidates = [];
  traverse(ast, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.object)) return;
      if (!t.isIdentifier(callee.property) || callee.property.name !== 'login') return;
      if (!args.length || !t.isObjectExpression(args[0])) return;

      const localName = callee.object.name;
      const binding = path.scope.getBinding(localName);
      if (!binding) return;

      // Must be a NAMED import specifier (not default) for the exact name 'conference'
      if (!t.isImportSpecifier(binding.path.node)) return;
      const importedName = t.isIdentifier(binding.path.node.imported)
        ? binding.path.node.imported.name
        : binding.path.node.imported.value;
      if (importedName !== 'conference') return;

      const importDecl = binding.path.parent;
      if (!t.isImportDeclaration(importDecl) || !R05_PACKAGES.includes(importDecl.source.value)) return;

      const val = extractFromObjScoped(args[0], 'sdkAppId', path);
      if (val) candidates.push({ sdkappid: val, rule: 'R05', source_type: 'runtime_call', source_path_hint: relativePath, matched_field: 'sdkAppId' });
    },
  });
  return candidates;
}

function runR06(ast, relativePath) {
  const candidates = [];
  traverse(ast, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      if (!args.length || !t.isObjectExpression(args[0])) return;
      let isMatch = false;

      // Chained: useLoginState().login(...)
      if (
        t.isMemberExpression(callee) &&
        t.isCallExpression(callee.object) &&
        t.isIdentifier(callee.object.callee) && callee.object.callee.name === 'useLoginState' &&
        t.isIdentifier(callee.property) && callee.property.name === 'login'
      ) {
        isMatch = true;
      }

      // Destructured: login(...) where binding comes from useLoginState()
      if (!isMatch && t.isIdentifier(callee)) {
        const binding = path.scope.getBinding(callee.name);
        if (binding && isLoginFromHook(binding, 'useLoginState', callee.name)) isMatch = true;
      }

      if (!isMatch) return;
      const val = extractFromObjScoped(args[0], 'sdkAppId', path);
      if (val) candidates.push({ sdkappid: val, rule: 'R06', source_type: 'runtime_call', source_path_hint: relativePath, matched_field: 'sdkAppId' });
    },
  });
  return candidates;
}

function runR07(ast, relativePath) {
  const candidates = [];
  traverse(ast, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.object)) return;
      if (!t.isIdentifier(callee.property) || callee.property.name !== 'enterRoom') return;
      if (!args.length || !t.isObjectExpression(args[0])) return;

      const clientName = callee.object.name;
      const clientBinding = path.scope.getBinding(clientName);
      // Client must be constant (no reassignment) and declared with const
      if (!clientBinding || !clientBinding.constant) return;
      if (!t.isVariableDeclarator(clientBinding.path.node)) return;
      const clientVarDecl = clientBinding.path.parent;
      if (!t.isVariableDeclaration(clientVarDecl) || clientVarDecl.kind !== 'const') return;

      // Client init must be TRTC.create(...)
      const init = clientBinding.path.node.init;
      if (!t.isCallExpression(init)) return;
      if (!t.isMemberExpression(init.callee) || !t.isIdentifier(init.callee.object)) return;
      if (!t.isIdentifier(init.callee.property) || init.callee.property.name !== 'create') return;

      // TRTC must be a default import from the allowlisted package
      const trtcName = init.callee.object.name;
      const trtcBinding = path.scope.getBinding(trtcName);
      if (!trtcBinding) return;
      if (!t.isImportDefaultSpecifier(trtcBinding.path.node)) return;
      const importDecl = trtcBinding.path.parent;
      if (!t.isImportDeclaration(importDecl)) return;
      if (!R07_PACKAGES.includes(importDecl.source.value)) return;

      const val = extractFromObjScoped(args[0], 'sdkAppId', path);
      if (val) candidates.push({ sdkappid: val, rule: 'R07', source_type: 'runtime_call', source_path_hint: relativePath, matched_field: 'sdkAppId' });
    },
  });
  return candidates;
}

// ── Core extraction functions ─────────────────────────────────────────────────

function extractScript(source, ext, relativePath) {
  const opts = babelOptions(ext);
  let ast;
  try {
    ast = babelParse(source, {
      ...opts,
      errorRecovery: false,
      strictMode: opts.strictMode ?? true,
    });
  } catch {
    return { status: 'invalid', candidates: [], constBindings: new Map() };
  }

  try {
    const constBindings = buildScriptConstBindings(ast);
    const candidates = [
      ...runR01(ast, relativePath),
      ...runR03(ast, relativePath),
      ...runR04(ast, relativePath),
      ...runR05(ast, relativePath),
      ...runR06(ast, relativePath),
      ...runR07(ast, relativePath),
    ];
    candidates.push(...runR18(ast, relativePath, candidates));
    return { status: 'ok', candidates, constBindings };
  } catch {
    return { status: 'invalid', candidates: [], constBindings: new Map() };
  }
}

function extractVue(source, relativePath) {
  let descriptor, errors;
  try {
    ({ descriptor, errors } = parseSFC(source, { filename: relativePath }));
  } catch {
    return { status: 'invalid', candidates: [] };
  }
  if (errors && errors.length > 0) return { status: 'invalid', candidates: [] };

  const allCandidates = [];
  const scriptSetupBindings = new Map();

  for (const [block, isSetup] of [[descriptor.script, false], [descriptor.scriptSetup, true]]) {
    if (!block?.content) continue;
    const blockExt = block.lang ? `.${block.lang}` : '.js';
    const result = extractScript(block.content, blockExt, relativePath);
    if (result.status === 'invalid') return { status: 'invalid', candidates: [] };
    allCandidates.push(...result.candidates);
    // Collect top-level const bindings from script setup for template :SDKAppID="var" lookup
    if (isSetup) {
      for (const [k, v] of result.constBindings) scriptSetupBindings.set(k, v);
    }
  }

  // Template block (R02) with script setup bindings available
  if (descriptor.template?.content) {
    const result = runR02_template(descriptor.template.content, relativePath, scriptSetupBindings);
    if (result.status === 'invalid') return { status: 'invalid', candidates: [] };
    allCandidates.push(...result.candidates);
  }

  return { status: 'ok', candidates: allCandidates };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * extract — parse one file and return structured SDKAppID candidates.
 *
 * @param {{ source: string, relativePath: string, ext: string, byteLength: number }} file
 * @returns {{ status: 'ok' | 'invalid', candidates: Array }}
 */
export function extract({ source, relativePath, ext }) {
  try {
    if (ext === '.vue') return extractVue(source, relativePath);
    const result = extractScript(source, ext, relativePath);
    return { status: result.status, candidates: result.candidates };
  } catch {
    return { status: 'invalid', candidates: [] };
  }
}
