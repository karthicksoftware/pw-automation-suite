import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { sourceFiles } from './files.js';

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

const locatorMethods = new Set([
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'getByTestId',
  'frameLocator',
  '$',
  '$$',
]);
const rawFixtures = new Set(['page', 'context', 'browser', 'request']);

export function analyzeSource(file: string, text: string): Violation[] {
  const normalized = file.replaceAll('\\', '/');
  const applicationTest = normalized.startsWith('tests/') && normalized.endsWith('.spec.ts');
  const assertionModule = normalized.startsWith('src/assertions/');
  const businessTest = /^tests\/(ui|api)\//.test(normalized) && applicationTest;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: Violation[] = [];
  const testNames = new Set(['test']);
  const expectNames = new Set(['expect']);
  let fixtureImport = false;

  function add(node: ts.Node, rule: string, message: string): void {
    violations.push({
      file,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      rule,
      message,
    });
  }

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const specifier = statement.moduleSpecifier.text;
    const target = specifier.startsWith('.')
      ? relative(process.cwd(), resolve(dirname(resolve(file)), specifier)).replaceAll('\\', '/')
      : specifier;
    const bindings = statement.importClause?.namedBindings;
    if (target === 'src/fixtures/test.js' || target === 'src/fixtures/test.ts') {
      fixtureImport = true;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) {
          const original = binding.propertyName?.text ?? binding.name.text;
          if (original === 'test') testNames.add(binding.name.text);
          if (original === 'expect' || original === 'expectCartLine')
            expectNames.add(binding.name.text);
        }
      }
    }
    if (
      applicationTest &&
      /^(?:@playwright\/test|playwright\/test)$/.test(specifier) &&
      !statement.importClause?.isTypeOnly
    ) {
      add(
        statement,
        'fixture-import',
        'Application tests must import test/expect from src/fixtures/test.js.',
      );
    }
    const layer = normalized.split('/')[1];
    const targetLayer = target.startsWith('src/') ? target.split('/')[1] : undefined;
    const allowed: Record<string, readonly string[]> = {
      domain: ['domain'],
      data: ['domain', 'data'],
      config: ['config'],
      api: ['api', 'config', 'domain'],
      pages: ['pages', 'domain'],
      assertions: ['assertions', 'pages', 'domain'],
      fixtures: ['fixtures', 'api', 'pages', 'data', 'domain', 'config', 'assertions'],
    };
    if (
      normalized.startsWith('src/') &&
      layer &&
      targetLayer &&
      !allowed[layer]?.includes(targetLayer)
    ) {
      add(statement, 'layer-boundary', `${layer} must not import ${targetLayer}.`);
    }
    if (normalized.startsWith('src/') && /^(tests|scripts)\//.test(target)) {
      add(statement, 'layer-boundary', 'Framework source must not depend on tests or scripts.');
    }
    if (businessTest && targetLayer && !['fixtures', 'domain', 'data'].includes(targetLayer)) {
      add(
        statement,
        'layer-boundary',
        'Business tests use fixtures, domain types, and factories rather than constructing clients or pages.',
      );
    }
  }
  if (applicationTest && !fixtureImport)
    add(source, 'fixture-import', 'Missing framework fixture entrypoint import.');

  function rootIdentifier(node: ts.Expression): string | undefined {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return rootIdentifier(node.expression);
    return undefined;
  }

  function containsAssertion(node: ts.Node): boolean {
    let found = false;
    function visit(child: ts.Node): void {
      if (
        ts.isCallExpression(child) &&
        ts.isIdentifier(child.expression) &&
        expectNames.has(child.expression.text)
      ) {
        const actual = child.arguments[0];
        if (
          actual &&
          !ts.isLiteralExpression(actual) &&
          ![
            ts.SyntaxKind.TrueKeyword,
            ts.SyntaxKind.FalseKeyword,
            ts.SyntaxKind.NullKeyword,
          ].includes(actual.kind)
        )
          found = true;
      }
      ts.forEachChild(child, visit);
    }
    visit(node);
    return found;
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isPropertyAccessExpression(expression)) {
        const method = expression.name.text;
        if (
          method === 'waitForTimeout' ||
          (method === 'setTimeout' && !testNames.has(rootIdentifier(expression) ?? ''))
        )
          add(node, 'no-sleep', 'Use web-first assertions or an observable application event.');
        if ((applicationTest || assertionModule) && locatorMethods.has(method))
          add(node, 'page-object-selectors', 'Construct selectors inside page objects/components.');
        if (
          (businessTest || assertionModule) &&
          ['evaluate', 'addInitScript', 'route', 'routeFromHAR'].includes(method)
        )
          add(
            node,
            'no-state-injection',
            'Critical journeys must exercise the real application without state injection or mocks.',
          );
        if (
          testNames.has(rootIdentifier(expression) ?? '') &&
          ['only', 'skip', 'fixme', 'fail'].includes(method)
        ) {
          add(
            node,
            'no-disabled-tests',
            'Focused, skipped, and expected-failure tests cannot satisfy coverage.',
          );
        }
      }
      if (ts.isIdentifier(expression) && expression.text === 'setTimeout')
        add(node, 'no-sleep', 'Fixed sleeps are forbidden.');
      if (applicationTest && ts.isIdentifier(expression) && testNames.has(expression.text)) {
        const callback = node.arguments.find(
          (argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
        );
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          if (!containsAssertion(callback))
            add(
              callback,
              'meaningful-assertion',
              'A test must assert a non-literal observed outcome.',
            );
          for (const parameter of callback.parameters) {
            if (ts.isObjectBindingPattern(parameter.name)) {
              for (const binding of parameter.name.elements) {
                const fixture =
                  binding.propertyName?.getText(source) ?? binding.name.getText(source);
                if (rawFixtures.has(fixture))
                  add(
                    binding,
                    'fixture-capabilities',
                    'Use app/api fixtures instead of raw browser or request fixtures.',
                  );
              }
            }
          }
        }
      }
    }
    const automationSource =
      applicationTest || /^src\/(pages|fixtures|assertions)\//.test(normalized);
    if (
      automationSource &&
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === 'force' &&
      node.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      add(node, 'no-force', 'Forced interactions hide actionability defects.');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

export function repositoryViolations(): Violation[] {
  return ['src', 'tests', 'scripts']
    .flatMap(sourceFiles)
    .flatMap((file) => analyzeSource(file, readFileSync(file, 'utf8')));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = repositoryViolations();
  for (const violation of violations)
    console.error(`${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`);
  if (violations.length) process.exitCode = 1;
  else console.log('Architecture boundaries and agent contribution rules passed.');
}
