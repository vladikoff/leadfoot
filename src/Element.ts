import findDisplayed from './lib/findDisplayed';
import * as fs from 'fs';
import Locator, { toW3cLocator } from './lib/Locator';
import waitForDeleted from './lib/waitForDeleted';
import { sleep } from './lib/util';
import Task from '@dojo/core/async/Task';
import Session from './Session';
import JSZip = require('jszip');
import { basename } from 'path';

/**
 * An Element represents a DOM or UI element within the remote environment.
 */
export default class Element extends Locator<Task<Element>, Task<Element[]>, Task<void>> {
	private _elementId: string;
	private _session: Session;

	/**
	 * @constructor module:leadfoot/Element
	 *
	 * @param elementId
	 * The ID of the element, as provided by the remote.
	 *
	 * @param session
	 * The session that the element belongs to.
	 */
	constructor(elementId: /*ElementOrElementId*/any, session?: Session) {
		super();

		this._elementId = elementId.ELEMENT || elementId.elementId || elementId['element-6066-11e4-a52e-4f735466cecf'] || elementId;
		this._session = session;
	}

	/**
	 * The opaque, remote-provided ID of the element.
	 *
	 * @member elementId
	 * @readonly
	 */
	get elementId() {
		return this._elementId;
	}

	/**
	 * The [[Session]] that the element belongs to.
	 * @readonly
	 */
	get session() {
		return this._session;
	}

	private _get<T>(path: string, requestData?: any, pathParts?: any): Task<any> {
		path = 'element/' + encodeURIComponent(this._elementId) + '/' + path;
		return this._session.serverGet<T>(path, requestData, pathParts);
	}

	private _post<T>(path: string, requestData?: any, pathParts?: any): Task<any> {
		path = 'element/' + encodeURIComponent(this._elementId) + '/' + path;
		return this._session.serverPost<T>(path, requestData, pathParts);
	}

	toJSON() {
		return { ELEMENT: this._elementId };
	}

	/**
	 * Normalize whitespace in the same way that most browsers generate innerText.
	 *
	 * @param text
	 * @returns Text with leading and trailing whitespace removed, with inner runs of spaces changed to a
	 * single space, and with "\r\n" pairs converted to "\n".
	 */
	private _normalizeWhitespace(text: string): string {
		if (text) {
			text = text
				.replace(/^\s+/, '')
				.replace(/\s+$/, '')
				.replace(/\s*\r\n\s*/g, '\n')
				.replace(/ +/g, ' ');
		}

		return text;
	}

	/**
	 * Uploads a file to a remote Selenium server for use when testing file uploads. This API is not part of the
	 * WebDriver specification and should not be used directly. To send a file to a server that supports file uploads,
	 * use [[Element.type]] to type the name of the local file into a file input field and the file
	 * will be transparently transmitted and used by the server.
	 */
	private _uploadFile(filename: string): Task<string> {
		return new Task(resolve => {
			const content = fs.readFileSync(filename);

			let zip = new JSZip();
			zip.file(basename(filename), content);
			const data = zip.generate({ type: 'base64' });
			zip = null;

			resolve(this.session.serverPost('file', { file: data }));
		});
	}

	/**
	 * Gets the first element within this element that matches the given query.
	 *
	 * @see [[Session.setFindTimeout]] to set the amount of time it the remote environment
	 * should spend waiting for an element that does not exist at the time of the `find` call before timing
	 * out.
	 *
	 * @param using
	 * The element retrieval strategy to use. See [[Session.find]] for options.
	 *
	 * @param value
	 * The strategy-specific value to search for. See [[Session.find]] for details.
	 */
	find(using: string, value: string): Task<Element> {
		const session = this._session;

		if (session.capabilities.isWebDriver) {
			const locator = toW3cLocator(using, value);
			using = locator.using;
			value = locator.value;
		}

		if (using.indexOf('link text') !== -1 && this.session.capabilities.brokenWhitespaceNormalization) {
			return this.session.execute<any>(/* istanbul ignore next */ this.session['_manualFindByLinkText'], [
				using, value, false, this
			]).then(function (element: ElementOrElementId) {
				if (!element) {
					const error = new Error();
					error.name = 'NoSuchElement';
					throw error;
				}
				return new Element(element, session);
			});
		}

		return this._post('element', {
			using,
			value
		}).then(function (element) {
			return new Element(element, session);
		}).catch(function (error) {
			// At least Firefox 49 + geckodriver returns an UnknownCommand error when unable to find elements.
			if (error.name === 'UnknownCommand' && error.message.indexOf('Unable to locate element:') !== -1) {
				const newError = new Error();
				newError.name = 'NoSuchElement';
				newError.message = error.message;
				throw newError;
			}
			throw error;
		});
	}

	/**
	 * Gets all elements within this element that match the given query.
	 *
	 * @param using
	 * The element retrieval strategy to use. See [[Session.find]] for options.
	 *
	 * @param value
	 * The strategy-specific value to search for. See [[Session.find]] for details.
	 */
	findAll(using: string, value: string): Task<Element[]> {
		const session = this._session;

		if (session.capabilities.isWebDriver) {
			const locator = toW3cLocator(using, value);
			using = locator.using;
			value = locator.value;
		}

		if (using.indexOf('link text') !== -1 && this.session.capabilities.brokenWhitespaceNormalization) {
			return this.session.execute(/* istanbul ignore next */ this.session['_manualFindByLinkText'], [
				using, value, true, this
			]).then(function (elements: ElementOrElementId[]) {
				return elements.map(function (element) {
					return new Element(element, session);
				});
			});
		}

		return this._post('elements', {
			using: using,
			value: value
		}).then(function (elements: ElementOrElementId[]) {
			return elements.map(function (element) {
				return new Element(element, session);
			});
		});
	}

	/**
	 * Clicks the element. This method works on both mouse and touch platforms.
	 */
	click() {
		if (this.session.capabilities.brokenClick) {
			return this.session.execute<void>((element: HTMLElement) => {
				element.click();
			}, [ this ]);
		}

		return this._post<void>('click').then(() => {
			// ios-driver 0.6.6-SNAPSHOT April 2014 and MS Edge Driver 14316 do not wait until the default action for
			// a click event occurs before returning
			if (this.session.capabilities.touchEnabled || this.session.capabilities.returnsFromClickImmediately) {
				return sleep(500);
			}
		});
	}

	/**
	 * Submits the element, if it is a form, or the form belonging to the element, if it is a form element.
	 */
	submit() {
		if (this.session.capabilities.brokenSubmitElement) {
			return this.session.execute<void>(/* istanbul ignore next */ (element: any) => {
				if (element.submit) {
					element.submit();
				}
				else if (element.type === 'submit' && element.click) {
					element.click();
				}
			}, [ this ]);
		}

		return this._post<void>('submit');
	}

	/**
	 * Gets the visible text within the element. `<br>` elements are converted to line breaks in the returned
	 * text, and whitespace is normalised per the usual XML/HTML whitespace normalisation rules.
	 */
	getVisibleText(): Task<string> {
		const result = this._get('text');

		if (this.session.capabilities.brokenWhitespaceNormalization) {
			return result.then(text => this._normalizeWhitespace(text));
		}

		return result;
	}

	/**
	 * Types into the element. This method works the same as the [[Session.pressKeys]] method
	 * except that any modifier keys are automatically released at the end of the command. This method should be used
	 * instead of [[Session.pressKeys]] to type filenames into file upload fields.
	 *
	 * Since 1.5, if the WebDriver server supports remote file uploads, and you type a path to a file on your local
	 * computer, that file will be transparently uploaded to the remote server and the remote filename will be typed
	 * instead. If you do not want to upload local files, use [[Session.pressKeys]] instead.
	 *
	 * @param value
	 * The text to type in the remote environment. See [[Session.pressKeys]] for more information.
	 */
	type(value: string|string[]): Task<void> {
		const getPostData = (value: string[]): { value: string[] } => {
			if (this.session.capabilities.isWebDriver) {
				return { value: value.join('').split('') };
			}
			return { value };
		};

		if (!Array.isArray(value)) {
			value = [ value ];
		}

		if (this.session.capabilities.remoteFiles) {
			const filename = value.join('');

			// Check to see if the input is a filename; if so, upload the file and then post it's remote name into the
			// field
			try {
				if (fs.statSync(filename).isFile()) {
					return this._uploadFile(filename).then(uploadedFilename => {
						return this._post('value', getPostData([ uploadedFilename ])).then(noop);
					});
				}
			}
			catch (error) {
				// ignore
			}
		}

		// If the input isn't a filename, just post the value directly
		return this._post('value', getPostData(value)).then(noop);
	}

	/**
	 * Gets the tag name of the element. For HTML documents, the value is always lowercase.
	 */
	getTagName(): Task<string> {
		return this._get('name').then((name: string) => {
			if (this.session.capabilities.brokenHtmlTagName) {
				return this.session.execute(
					'return document.body && document.body.tagName === document.body.tagName.toUpperCase();'
				).then(function (isHtml: boolean) {
					return isHtml ? name.toLowerCase() : name;
				});
			}

			return name;
		});
	}

	/**
	 * Clears the value of a form element.
	 */
	clearValue(): Task<void> {
		return this._post('clear').then(noop);
	}

	/**
	 * Returns whether or not a form element is currently selected (for drop-down options and radio buttons), or
	 * whether or not the element is currently checked (for checkboxes).
	 */
	isSelected(): Task<boolean> {
		return this._get('selected');
	}

	/**
	 * Returns whether or not a form element can be interacted with.
	 */
	isEnabled(): Task<boolean> {
		return this._get('enabled');
	}

	/**
	 * Gets a property or attribute of the element according to the WebDriver specification algorithm. Use of this
	 * method is not recommended; instead, use [[Element.getAttribute]] to retrieve DOM attributes
	 * and [[Element.getProperty]] to retrieve DOM properties.
	 *
	 * This method uses the following algorithm on the server to determine what value to return:
	 *
	 * 1. If `name` is 'style', returns the `style.cssText` property of the element.
	 * 2. If the attribute exists and is a boolean attribute, returns 'true' if the attribute is true, or null
	 *    otherwise.
	 * 3. If the element is an `<option>` element and `name` is 'value', returns the `value` attribute if it exists,
	 *    otherwise returns the visible text content of the option.
	 * 4. If the element is a checkbox or radio button and `name` is 'selected', returns 'true' if the element is
	 *    checked, or null otherwise.
	 * 5. If the returned value is expected to be a URL (e.g. element is `<a>` and attribute is `href`), returns the
	 *    fully resolved URL from the `href`/`src` property of the element, not the attribute.
	 * 6. If `name` is 'class', returns the `className` property of the element.
	 * 7. If `name` is 'readonly', returns 'true' if the `readOnly` property is true, or null otherwise.
	 * 8. If `name` corresponds to a property of the element, and the property is not an Object, return the property
	 *    value coerced to a string.
	 * 9. If `name` corresponds to an attribute of the element, return the attribute value.
	 *
	 * @param name The property or attribute name.
	 * @returns The value of the attribute as a string, or `null` if no such property or
	 * attribute exists.
	 */
	getSpecAttribute(name: string): Task<string> {
		return this._get('attribute/$0', null, [ name ]).then((value) => {
			if (this.session.capabilities.brokenNullGetSpecAttribute && (value === '' || value === undefined)) {
				return this.session.execute(/* istanbul ignore next */ function (element: HTMLElement, name: string) {
					return element.hasAttribute(name);
				}, [ this, name ]).then(function (hasAttribute: boolean) {
					return hasAttribute ? value : null;
				});
			}

			return value;
		}).then(function (value) {
			// At least ios-driver 0.6.6-SNAPSHOT violates draft spec and returns boolean attributes as
			// booleans instead of the string "true" or null
			if (typeof value === 'boolean') {
				value = value ? 'true' : null;
			}

			return value;
		});
	}

	/**
	 * Gets an attribute of the element.
	 *
	 * @see [[Element.getProperty]] to retrieve an element property.
	 * @param name The name of the attribute.
	 * @returns The value of the attribute, or `null` if no such attribute exists.
	 */
	getAttribute(name: string): Task<string> {
		return this.session.execute('return arguments[0].getAttribute(arguments[1]);', [ this, name ]);
	}

	/**
	 * Gets a property of the element.
	 *
	 * @see [[Element.getAttribute]] to retrieve an element attribute.
	 * @param name The name of the property.
	 * @returns The value of the property.
	 */
	getProperty(name: string): Task<any> {
		return this.session.execute('return arguments[0][arguments[1]];', [ this, name ]);
	}

	/**
	 * Determines if this element is equal to another element.
	 */
	equals(other: Element): Task<boolean> {
		const elementId = other.elementId || other;
		return this._get('equals/$0', null, [ elementId ]).catch((error) => {
			// At least Selendroid 0.9.0 does not support this command;
			// At least ios-driver 0.6.6-SNAPSHOT April 2014 fails
			if (error.name === 'UnknownCommand' ||
				(error.name === 'UnknownError' && error.message.indexOf('bug.For input string:') > -1)
			) {
				return this.session.execute('return arguments[0] === arguments[1];', [ this, other ]);
			}

			throw error;
		});
	}

	/**
	 * Returns whether or not the element would be visible to an actual user. This means that the following types
	 * of elements are considered to be not displayed:
	 *
	 * 1. Elements with `display: none`
	 * 2. Elements with `visibility: hidden`
	 * 3. Elements positioned outside of the viewport that cannot be scrolled into view
	 * 4. Elements with `opacity: 0`
	 * 5. Elements with no `offsetWidth` or `offsetHeight`
	 */
	isDisplayed(): Task<boolean> {
		return this._get('displayed').then((isDisplayed: boolean) => {

			if (isDisplayed && (
				this.session.capabilities.brokenElementDisplayedOpacity ||
				this.session.capabilities.brokenElementDisplayedOffscreen
			)) {
				return this.session.execute(/* istanbul ignore next */ function (element: HTMLElement) {
					const scrollX = document.documentElement.scrollLeft || document.body.scrollLeft;
					const scrollY = document.documentElement.scrollTop || document.body.scrollTop;
					do {
						if (window.getComputedStyle(element, null).opacity === '0') {
							return false;
						}

						const bbox = element.getBoundingClientRect();
						if (bbox.right + scrollX <= 0 || bbox.bottom + scrollY <= 0) {
							return false;
						}
					}
					while ((element = <HTMLElement> element.parentNode) && element.nodeType === 1);
					return true;
				}, [ this ]);
			}

			return isDisplayed;
		});
	}

	/**
	 * Gets the position of the element relative to the top-left corner of the document, taking into account
	 * scrolling and CSS transformations (if they are supported).
	 */
	getPosition(): Task<{ x: number, y: number }> {
		if (this.session.capabilities.brokenElementPosition) {
			/* jshint browser:true */
			return this.session.execute(/* istanbul ignore next */ function (element: HTMLElement) {
				const bbox = element.getBoundingClientRect();
				const scrollX = document.documentElement.scrollLeft || document.body.scrollLeft;
				const scrollY = document.documentElement.scrollTop || document.body.scrollTop;

				return { x: scrollX + bbox.left, y: scrollY + bbox.top };
			}, [ this ]);
		}

		return this._get('location').then(function (position: { x: number, y: number }) {
			// At least FirefoxDriver 2.41.0 incorrectly returns an object with additional `class` and `hCode`
			// properties
			return { x: position.x, y: position.y };
		});
	}

	/**
	 * Gets the size of the element, taking into account CSS transformations (if they are supported).
	 */
	getSize(): Task<{ width: number, height: number }> {
		const getUsingExecute = () => {
			return this.session.execute(/* istanbul ignore next */ function (element: HTMLElement) {
				const bbox = element.getBoundingClientRect();
				return { width: bbox.right - bbox.left, height: bbox.bottom - bbox.top };
			}, [ this ]);
		};

		if (this.session.capabilities.brokenCssTransformedSize) {
			return getUsingExecute();
		}

		return this._get('size').catch(function (error) {
			// At least ios-driver 0.6.0-SNAPSHOT April 2014 does not support this command
			if (error.name === 'UnknownCommand') {
				return getUsingExecute();
			}

			throw error;
		}).then(function (dimensions) {
			// At least ChromeDriver 2.9 incorrectly returns an object with an additional `toString` property
			return { width: dimensions.width, height: dimensions.height };
		});
	}

	/**
	 * Gets a CSS computed property value for the element.
	 *
	 * @param propertyName
	 * The CSS property to retrieve. This argument must be hyphenated, *not* camel-case.
	 */
	getComputedStyle(propertyName: string): Task<string> {
		const manualGetStyle = () => {
			return this.session.execute(/* istanbul ignore next */ function (element: any, propertyName: string) {
				return (<any> window.getComputedStyle(element, null))[propertyName];
			}, [ this, propertyName ]);
		};

		let promise: Task<string>;

		if (this.session.capabilities.brokenComputedStyles) {
			promise = manualGetStyle();
		}
		else {
			promise = this._get('css/$0', null, [ propertyName ]).catch(function (error) {
				// At least Selendroid 0.9.0 does not support this command
				if (error.name === 'UnknownCommand') {
					return manualGetStyle();
				}

				// At least ChromeDriver 2.9 incorrectly returns an error for property names it does not understand
				else if (error.name === 'UnknownError' && error.message.indexOf('failed to parse value') > -1) {
					return '';
				}

				throw error;
			});
		}

		return promise.then(function (value) {
			// At least ChromeDriver 2.9 and Selendroid 0.9.0 returns colour values as rgb instead of rgba
			if (value) {
				value = value.replace(/(.*\b)rgb\((\d+,\s*\d+,\s*\d+)\)(.*)/g, function (_, prefix, rgb, suffix) {
					return prefix + 'rgba(' + rgb + ', 1)' + suffix;
				});
			}

			// For consistency with Firefox, missing values are always returned as empty strings
			return value != null ? value : '';
		});
	}

	/**
	 * Gets the first [[Element.isDisplayed displayed]] element inside this element
	 * matching the given query. This is inherently slower than [[Element.find]], so should only be
	 * used in cases where the visibility of an element cannot be ensured in advance.
	 *
	 * @since 1.6
	 *
	 * @param using
	 * The element retrieval strategy to use. See [[Session.find]] for options.
	 *
	 * @param value
	 * The strategy-specific value to search for. See [[Session.find]] for details.
	 */
	findDisplayed(using: string, value: string): Task<Element> {
		return findDisplayed(this.session, this, using, value);
	}

	/**
	 * Waits for all elements inside this element that match the given query to be destroyed.
	 *
	 * @method waitForDeleted
	 * @memberOf module:leadfoot/Element#
	 *
	 * @param using
	 * The element retrieval strategy to use. See [[Session.find]] for options.
	 *
	 * @param value
	 * The strategy-specific value to search for. See [[Session.find]] for details.
	 */
	waitForDeleted(strategy: string, value: string) {
		return waitForDeleted(this.session, this, strategy, value);
	}
}

function noop() {
	// At least ios-driver 0.6.6 returns an empty object for methods that are supposed to return no value at all,
	// which is not correct
}

export type ElementOrElementId = { ELEMENT: string; } | Element | string;
