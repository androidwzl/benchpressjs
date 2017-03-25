'use strict';

const t = require('babel-types');

// Helpers for constructing AST nodes
function PathExpression(path) {
	const iterPattern = /^(.*)\[(\d+)]$/;
	const paths = path.split('.').reduce((prev, key) => {
		const matches = key.match(iterPattern);
		if (matches) {
			const [, rest, index] = matches;
			return [...prev, t.stringLiteral(rest), t.identifier(`key${index}`)];
		}
		return [...prev, t.stringLiteral(key)];
	}, []);

	return t.arrayExpression(paths);
}
function GetCall(path, fallback) {
	const paths = PathExpression(path);
	return t.callExpression(t.identifier('get'), fallback ? [
		paths,
		t.stringLiteral(fallback),
	] : [paths]);
}
function EchoCall(output) {
	return t.callExpression(t.identifier('echo'), [output]);
}

const transforms = {
	StringLiteral(branch) {
		return t.stringLiteral(branch.value);
	},
	SimpleExpression(branch) { // , fallback) {
		const path = branch.path;
		if (path === '@key') {
			return t.identifier('key');
		}
		if (path === '@index') {
			return t.identifier('index');
		}
		if (path === '@first') {
			return t.binaryExpression('===', t.identifier('index'), t.numericLiteral(0));
		}
		if (path === '@last') {
			return t.binaryExpression('===', t.identifier('index'), t.binaryExpression(
				'-',
				t.identifier('length'),
				t.numericLiteral(1)
			));
		}

		return GetCall(path);
		// if the mustache source should show up when not found
		// return GetCall(path, fallback);
	},
	HelperExpression(branch) {
		return t.callExpression(t.identifier('helper'), [
			t.stringLiteral(branch.helperName),
			t.arrayExpression(compile(branch.args)),
		]);
	},
	OpenIf(branch, nextBranch) {
		let test = transforms[branch.test.tokenType](branch.test);
		if (branch.not) {
			test = t.unaryExpression('!', test, true);
		}

		let alternate = null;
		if (nextBranch && nextBranch.tokenType === 'Else') {
			alternate = t.blockStatement(compile(nextBranch.body));

			nextBranch.skipThis = true;
		}

		return t.ifStatement(test, t.blockStatement(compile(branch.body)), alternate);
	},
	OpenIter(branch) {
		const key = t.identifier(`key${branch.iterSuffix}`);
		const index = t.identifier(`index${branch.iterSuffix}`);
		const length = t.identifier(`length${branch.iterSuffix}`);

		const iter = t.callExpression(t.identifier('iter'), [
			PathExpression(branch.subject.path),
			t.functionExpression(t.identifier('each'), [
				key,
				index,
				length,
			], t.blockStatement([
				t.variableDeclaration('var', [t.variableDeclarator(t.identifier('key'), key)]),
				t.variableDeclaration('var', [t.variableDeclarator(t.identifier('index'), index)]),
				t.variableDeclaration('var', [t.variableDeclarator(t.identifier('length'), length)]),
				...compile(branch.body),
			])),
		]);
		iter.name = branch.name;
		iter.cleanName = branch.cleanName;

		return t.expressionStatement(iter);
	},
	Text(branch) {
		return t.expressionStatement(
			EchoCall(t.stringLiteral(branch.value))
		);
	},
	RawMustache(branch) {
		return t.expressionStatement(
			EchoCall(transforms[branch.expression.tokenType](branch.expression, branch.raw))
		);
	},
	EscapedMustache(branch) {
		return transforms.RawMustache(branch);
	},
};

/**
 * Transform a template syntax tree into a Babylon AST
 * @param {object[]} body
 * @returns {object[]}
 */
function compile(body) {
	const compiled = [];
	const len = body.length;
	for (let i = 0; i < len; i += 1) {
		const branch = body[i];
		if (!branch.skipThis) {
			compiled.push(transforms[branch.tokenType](branch, ...body.slice(i + 1)));
		}
	}

	return compiled;
}

/**
 * Transform a template syntax tree into a Babylon AST
 * @param {object[]} parsed
 * @returns {object}
 */
function compiler(parsed) {
	const compiled = compile(parsed);

	return t.functionDeclaration(t.identifier('compiled'), [
		t.identifier('get'),
		t.identifier('iter'),
		t.identifier('helper'),
		t.identifier('echo'),
	], t.blockStatement(compiled));
}

compiler.transforms = transforms;

module.exports = compiler;