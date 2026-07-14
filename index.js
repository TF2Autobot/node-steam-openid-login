const { CookieJar } = require('tough-cookie');
const fetchCookie = require('fetch-cookie');
const cheerio = require('cheerio');

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
        // Replaced request.jar() with native tough-cookie CookieJar
        jar = new CookieJar();

        cookies.forEach(cookieStr => {
            jar.setCookieSync(cookieStr, 'https://steamcommunity.com');
        });
    } else {
        jar = cookies;
    }

    // Wrap native fetch with the cookie jar
    const fetchWithCookie = fetchCookie(fetch, jar);

    // Go to path for signing in through Steam and follow redirects
    (async () => {
        try {
            const response = await fetchWithCookie(url, {
                method: 'GET',
                redirect: 'follow' // Replicates followAllRedirects: true
            });

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

            // Send form to steam and follow redirects back to the website we are signing in to
            const postResponse = await fetchWithCookie('https://steamcommunity.com/openid/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                // Converts the original formData object into a URL-encoded string
                body: new URLSearchParams(formData).toString(),
                redirect: 'follow'
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
