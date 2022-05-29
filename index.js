const axios = require('axios').default;
const tough = require('tough-cookie');
const wrapper = require('axios-cookiejar-support').wrapper;

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
        jar = new tough.CookieJar();

        cookies.forEach(function (cookieStr) {
            const cookie = tough.Cookie.parse(cookieStr);
            jar.setCookie(cookie, 'https://steamcommunity.com');
        });
    } else {
        jar = cookies;
    }

    const client = wrapper(axios.create({ jar }));

    // Go to path for signing in through Steam and follow redirects

    client({
        method: 'GET',
        url: url,
    })
        .then((response) => {
            if (response.request.uri.host !== 'steamcommunity.com') {
                return callback(
                    new Error(
                        'Was not redirected to steam, make sure the url is correct'
                    )
                );
            }

            const body = response.data;
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

            client({
                method: 'POST',
                url: 'https://steamcommunity.com/openid/login',
                data: formData,
            })
                .then((response) => {
                    // Return cookie jar
                    callback(null, jar);
                })
                .catch((err) => {
                    if (err) {
                        callback(err);
                    }
                });
        })
        .catch((err) => {
            if (err) {
                callback(err);
            }
        });
};
