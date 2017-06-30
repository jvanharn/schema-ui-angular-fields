/**
 * All signaltypes for handling non-normal form states.
 */


/**
 * Signal send by a field to a form implementation.
 */
export class Signal { }

/**
 * Something went wrong in the logic to initialize the form field(s).
 */
export class FieldInstantiationError extends Signal { }

/**
 * The initial values for the current form with it's parameters/settings could not be retrieved/loaded and should
 * therefore instead show a "404 not found" or similar.
 */
export class FormValuesNotFoundError extends Signal { }

/**
 * The state of the form has been altered in such a way that the state has been completely invalidated and must be (force-)reloaded.
 * E.g. without confirmation to the user.
 */
export class FormInvalidationSignal extends Signal { }

/**
 * The user or some component performed an action that cancelled the opening of the form, and the component should navigate away from this form.
 */
export class FormCancelationSignal extends Signal { }
