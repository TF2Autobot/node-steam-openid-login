const { CookieJar } = require('tough-cookie');
const fetchCookieModule = require('fetch-cookie');
const fetchCookie = fetchCookieModule.default || fetchCookieModule;
const cheerio = require('cheerio');

/**
 * Helper function to execute requests and follow redirects manually.
 * This guarantees fetch-cookie intercepts intermediate Set-Cookie headers.
 * 
 * @param {Function} fetchFn Wrapped fetch function with cookie capabilities
 * @param {String} url The initial destination target URL
 * @param {Object} options Configuration parameters for the HTTP request
 * @returns {Promise<Response>} The final HTTP response object
 */
async function fetchWithManualRedirects(fetchFn, url, options = {}) {
    let currentUrl = url;
    let method = options.method || 'GET';
    let headers = options.headers ? { ...options.headers } : {};
    let body = options.body;
    
    let redirectCount = 0;
    const maxRedirects = 15;

    while (redirectCount < maxRedirects) {
        const response = await fetchFn(currentUrl, {
            method,
            headers,
            body,
            redirect: 'manual'
        });

        // Intercept HTTP redirect states (301, 302, 303, 307, 308)
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) {
                return response; // No location header provided, break out and return
            }

            // Securely resolve relative redirect locations against the current URL context
            currentUrl = new URL(location, currentUrl).toString();
            redirectCount++;

            // Standard HTTP specification processing: 301, 302, and 303 mutate POST requests into GET requests
            if (response.status === 301 || response.status === 302 || response.status === 303) {
                method = 'GET';
                body = undefined;
                if (headers['Content-Type']) {
                    delete headers['Content-Type'];
                }
            }
            continue;
        }
        return response;
    }
    throw new Error('Too many redirects');
}

/**
 * Signs in to a website through Steam
 * @param {String} url The URL you would go to, to sign in through Steam
 * @param {Array<String>|Object} cookies An array of cookies as strings or a cookie jar that contains cookies from a session which is logged in to steamcommunity.com
 * @param {Function} callback
 */
module.exports = function (url, cookies, callback) {
    // TODO: Custom request options (proxy, headers...)

    let jar;

    if (Array.isArray(cookies)) {
        jar = new CookieJar();

        cookies.forEach(cookieStr => {
            jar.setCookieSync(cookieStr, 'https://steamcommunity.com');
        });
    } else {
        jar = cookies;
    }

    // Wrap native fetch with the cookie jar
    const fetchWithCookie = fetchCookie(fetch, jar);

    // Go to path for signing in through Steam and follow redirects manually
    (async () => {
        try {
            const response = await fetchWithManualRedirects(fetchWithCookie, url, {
                method: 'GET'
            });

            if (!response.ok) {
                return callback(new Error(`HTTP Error on steam-openid-login: ${response.status} ${response.statusText}`));
            }

            // Replaces response.request.uri.host with fetch equivalent
            const finalUrl = new URL(response.url);
            if (finalUrl.hostname !== 'steamcommunity.com') {
                return callback(new Error('Was not redirected to steam, make sure the url is correct'));
            }

            const body = await response.text();
            const $ = cheerio.load(body);

            // If we are given a login form, then we are not signed in to steam
            if ($('#loginForm').length !== 0) {
                return callback(new Error('You are not signed in to Steam'));
            }

            const form = $('#openidForm');

            if (form.length !== 1) {
                return callback(new Error('Could not find OpenID login form'));
            }

            const inputs = form.find('input');
            const formData = {};

            // Get form data
            inputs.each(function (index, element) {
                const attribs = element.attribs;
                if (attribs.name) {
                    formData[attribs.name] = attribs.value;
                }
            });

            // Send form to steam and manually hop across redirects back to the website we are signing in to
            const postResponse = await fetchWithManualRedirects(fetchWithCookie, 'https://steamcommunity.com/openid/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams(formData).toString()
            });

            if (!postResponse.ok) {
                return callback(new Error(`Failed to post to steam: ${postResponse.statusText}`));
            }

            // Return cookie jar
            callback(null, jar);
        } catch (err) {
            callback(err);
        }
    })();
};