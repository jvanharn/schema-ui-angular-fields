import { FieldContextProvider } from './field-context-provider.service';

import * as jp from 'json-pointer';
import * as _ from 'lodash';

/**
 * Whether or not the given pointer is an relative pointer.
 *
 * Examples of relative JSON-Pointers
 * - 0 - Get our own value.
 * - 1/0 - Move up one step, and get the index 0 of the parent array.
 * - 2/highly/nested/objects - Move up 2 steps, and resolve the rest as an JSON-Pointer
 * - 0# - Get the key of a parent object.
 * @link rfc https://tools.ietf.org/html/draft-handrews-relative-json-pointer-00
 *
 * @param pointer
 */
export function isRelativePointer(pointer: string): boolean {
    return !Number.isNaN(parseInt(String(pointer).split('/').shift(), 10));
}

/**
 * Whether or not the given pointer is an absolutely pointer JSON-pointer. (With a schema included).
 *
 * Examples of absolute JSON-Pointers:
 * - https://example.org/schemas/lipsum#/somewhere/in/the/object
 * - https://example.org/schemas/lipsum#/0/somewhere/in/the/object
 * @param pointer
 */
export function isAbsolutePointer(pnt: string): boolean {
    return !isRelativePointer(pnt) && String(pnt).indexOf('#') >= 0;
}

/**
 * Whether or not the pointer is a regular JSON-Pointer.
 *
 * @param pointer
 */
export function isPlainPointer(pointer: string): boolean {
    return String(pointer)[0] === '/';
}

/**
 * Parse an relative pointer to its two components.
 *
 * @param pointer
 */
export function parseRelativePointer(pointer: string): [string, number] {
    var [rel, pnt] = pointer.split('/', 2);
    return ['/' + pnt, parseInt(rel)];
}

/**
 * Resolve an relative JSON pointer, to a regular one, with any remainder.
 *
 * @param pointer The relative pointer to resolve.
 * @param context Regular JSON-Pointer that points to where we currently are in the object.
 */
export function resolveRelativePointer([pnt, rel]: [string, number], context: string): [string, number] {
    if (rel === 0) {
        return [pnt, rel];
    }

    var parts = context.split('/').slice(1);
    if (rel >= parts.length) {
        return [String(pnt), rel - parts.length];
    }
    return ['/' + parts.slice(0, parts.length - rel).join('/') + String(pnt), 0];
}

/**
 * Check if the given relative pointer is done resolving (and is essentially an normal pointer now, with key-selection ability).
 */
export function isDoneResolvingRelativePointer([pnt, rel]: [string, number]): boolean {
    return rel <= 0;
}

/**
 * Wether or not the given pointer selects the key of it's parent.
 */
export function isKeySelectingRelativePointer([pnt, rel]: [string, number]): boolean {
    return pnt[pnt.length - 1] === '#';
}

/**
 * Traverse over anfield context object, and get the field value.
 *
 * @param pointer
 * @param relativeToPointer
 * @param context
 */
export function traverseFieldContextsWithRelativePointer(pointer: [string, number], relativeToPointer: string, context: FieldContextProvider): any {
    // Calculate the result
    var processResult = (parsed: [string, number]) => {
        if (isKeySelectingRelativePointer(parsed)) {
            if (parsed[0] === '#') {
                return relativeToPointer.split('/').pop();
            }
            else {
                return _.trim(parsed[0].split('/').pop(), '#');
            }
        }
        return context.getFieldValueByPointer(parsed[0]);
    };

    // Check if done already
    if (isDoneResolvingRelativePointer(pointer)) {
        return processResult(pointer);
    }

    // We need to resolve some more.
    var resolved = resolveRelativePointer(pointer, relativeToPointer);
    if (isDoneResolvingRelativePointer(resolved)) {
        return processResult(resolved);
    }
    else if (!!context.parent) {
        return traverseFieldContextsWithRelativePointer(pointer, context.schema.propertyPrefix, context.parent);
    }
    else {
        throw new Error(`Relative pointer "${pointer[1]}${pointer[0]}" cannot be resolved on schema [${context.schema.schemaId}] relative to pointer "${relativeToPointer}", it went out of bounds!`);
    }
}

/**
 * Parse an absolute pointer into the schemaId and the pointer as a tuple.
 *
 * @param pointer Absolute pointer.
 */
export function parseAbsolutePointer(pointer: string): [string, string] {
    var parsed = pointer.split('#', 2);
    return [parsed[0] + '#', parsed[1]];
}

/**
 * Get the value of an absolute pointer.
 *
 * @todo This method will not traverse sibblings, as the field context provider does not provide that kind of data at the time of writing.
 * @param parsedPointer The parsed absolute pointer.
 * @param context The field context provider to traverse.
 */
export function traverseFieldContextsWithAbsolutePointer([schemaId, pointer]: [string, string], context: FieldContextProvider): any {
    if (context.schema.schemaId === schemaId) {
        // We found it! So, resolve the pointer...
        return context.getFieldValueByPointer(pointer);
    }

    // Not the correct schema
    if (!!context.parent) {
        return traverseFieldContextsWithAbsolutePointer([schemaId, pointer], context.parent);
    }
    else {
        throw new Error(`The absolute pointer "${schemaId}${pointer}" could not be resolved raltive to context for schema [${context.schema.schemaId}].`);
    }
}
