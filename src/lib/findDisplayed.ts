import Task from '@dojo/core/async/Task';
import statusCodes from './statusCodes';
import Element from '../Element';
import Session from '../Session';
import { Thenable } from '../interfaces';

export default function findDisplayed(session: Session, locator: Session | Element, strategy: string, value: string) {
	return session.getTimeout('implicit').then(function (originalTimeout) {
		const startTime = Date.now();

		function poll(): Task<Element | Element[]> {
			return locator.findAll(strategy, value).then(function (elements: Element[]) {
				// Due to concurrency issues with at least ChromeDriver 2.16, each element must be tested one
				// at a time instead of using `Promise.all`
				let i = -1;
				function checkElement(): Thenable<Element|Element[]> {
					const element = elements[++i];
					if (element) {
						return element.isDisplayed().then(function (isDisplayed) {
							if (isDisplayed) {
								return element;
							}
							else {
								return checkElement();
							}
						});
					}
				}

				return Task.resolve(checkElement()).then(function (element) {
					if (element) {
						return element;
					}
					else if (Date.now() - startTime > originalTimeout) {
						const error: any = new Error();
						error.status = elements.length ? 11 : 7;
						error.name = (<any> statusCodes)[error.status][0];
						error.message = (<any> statusCodes)[error.status][1];
						throw error;
					}
					else {
						return poll();
					}
				});
			});
		}

		return poll();
	});
}
