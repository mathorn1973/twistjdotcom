/* Share an OpenQASM circuit as one URI-encoded fragment, compatible with
 * circuit links exported by Matematyka's Quantum Safecracker. */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.OQCircuitLink = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const prefix = '#qasm=';

    function read(hash) {
        if (typeof hash !== 'string' || !hash.startsWith(prefix)) return null;
        try {
            const source = decodeURIComponent(hash.slice(prefix.length));
            return source.trim() ? source : null;
        } catch (error) {
            if (error instanceof URIError) return null;
            throw error;
        }
    }

    function build(href, source) {
        if (typeof href !== 'string' || typeof source !== 'string' || !source.trim()) return null;
        try {
            const url = new URL(href);
            if (!['https:', 'http:', 'file:'].includes(url.protocol)) return null;
            url.hash = prefix + encodeURIComponent(source);
            return url.href;
        } catch (error) {
            if (error instanceof TypeError || error instanceof URIError) return null;
            throw error;
        }
    }

    return { read, build };
}));
