import registerSuite = require('intern!object');
import Test = require('intern/lib/Test');
import * as assert from 'intern/chai!assert';
import * as util from 'src/lib/util';

declare let __cov_abcdef: number;
declare let a: any;

registerSuite({
	name: 'lib/leadfoot/util',

	'.sleep'() {
		const startTime = Date.now();
		return util.sleep(250).then(function () {
			assert.closeTo(Date.now() - startTime, 250, 50);
		});
	},

	'.sleep canceler'(this: Test) {
		const startTime = Date.now();
		const sleep = util.sleep(10000);
		const dfd = this.async();
		sleep.cancel();
		sleep.finally(function() {
			assert.operator(Date.now() - startTime, '<', 500);
			dfd.resolve();
		});
	},

	'.forCommand'() {
		const commandFn: any = util.forCommand(function () {}, {
			createsContext: false,
			usesElement: true
		});
		assert.isFalse(commandFn.createsContext);
		assert.isTrue(commandFn.usesElement);
	},

	'.toExecuteString string'() {
		const script = util.toExecuteString('return a;');
		assert.strictEqual(script, 'return a;');
	},

	'.toExecuteString function'() {
		const script = util.toExecuteString(function () {
			__cov_abcdef++;
			return a;
		});
		assert.match(script, /^return \(function \(\) \{\s*return a;\s*\}\)\.apply\(this, arguments\);$/);
	}
});
