const Router = require('../classes/Router');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const redirect = encodeURIComponent('http://localhost:3000/api/passport/callback');

const fetch = require('node-fetch-commonjs');
const btoa = require('btoa');

function _encode(obj) {
    let string = "";

    for (const [key, value] of Object.entries(obj)) {
        if (!value) continue;
        string += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }

    return string.substring(1);
}

class API extends Router {
    constructor(client) {
        super(client, '/api');
    }
    createRoute() {

        this.router.get('/', async (req, res) => {
            try {
                let packageConf = require('../../package.json')
                res.json({
                    "message": "Welcome to the Protagnst-Secure API",
                    "version": packageConf.version
                });

            } catch (e) {
                console.log(e)
            }
        });

        this.router.get('/passport', (req, res) => {
            res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&scope=identify%20email%20guilds.join&response_type=code&redirect_uri=${redirect}`);
        });

        this.router.get('/passport/callback', async (req, res) => {
            if (!req.query.code) throw new Error('NoCodeProvided');
            const code = req.query.code;

            let urlData = {
                'client_id': CLIENT_ID,
                'client_secret': CLIENT_SECRET,
                'grant_type': 'authorization_code',
                'code': code,
                'redirect_uri': `http://localhost:3000/api/passport/callback`,
                'scope': 'identify%20email%20guilds.join'
            };

            let params = _encode(urlData);

            let response = await fetch(`https://discord.com/api/oauth2/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: params
            });
            const json = await response.json();

            let userResponse = await fetch(`https://discord.com/api/v10/users/@me`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${json.access_token}`
                }
            });
            const userJson = await userResponse.json();

            req.session.discordId = userJson.id;
            req.session.userTag = userJson.username + '#' + userJson.discriminator;

            res.set(200).redirect('/');
        });

        this.router.get('/logout', (req, res) => {
            req.session.destroy();
            res.redirect('/');
        });

        this.router.use((req, res) => {
            res.status(404).json({
                "error": "This API endpoint is invalid or has moved."
            });
        });

        return this.router
    }
}

module.exports = API;