const Router = require('../classes/Router');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const redirect = encodeURIComponent('http://localhost:3000/api/passport/callback');

const fetch = require('node-fetch-commonjs');
const { getAvailableForms, getPreviousSubmissions } = require('../utilities/formFunctions');
const { executeMysqlQuery } = require('../utilities/mysqlHelper');

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
            if (!req.query.code) return res.redirect('/auth');
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

            req.session.types_DiscordPassport = json;
            req.session.types_DiscordUser = userJson;

            req.session.discordId = userJson.id;
            req.session.userTag = userJson.username + '#' + userJson.discriminator;

            // check if user exists in database
            let userExists = await executeMysqlQuery(`SELECT * FROM users WHERE discord_id = ?`, [userJson.id]);
            // if user exists, delete
            if (userExists.length > 0) {
                let userOldPermission = userExists[0].permission_level;
                await executeMysqlQuery(`DELETE FROM users WHERE discord_id = ?`, [userJson.id]);
                await executeMysqlQuery(`INSERT INTO users (discord_id, refresh_token, permission_level) VALUES (?, ?, ?)` , [userJson.id, json.refresh_token, userOldPermission]);
            } else {
                await executeMysqlQuery(`INSERT INTO users (discord_id, refresh_token, permission_level) VALUES (?, ?, ?)` , [userJson.id, json.refresh_token, 1]);
            }

            res.set(200).redirect('/');
        });

        this.router.get('/utils/js/getAvailableForms', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });
            let forms = await getAvailableForms(req);
            if (forms) return res.json(forms);
            else return res.json({ "message": "There are no forms available for you right now!" });
        });

        this.router.get('/logout', (req, res) => {
            req.session.destroy();
            res.redirect('/');
        });

        // getQuestions API route
        this.router.get('/getQuestions/:formId', async (req, res) => {
            // check if user is logged in
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            // lock so only the server can use this endpoint
            // @todo if needed, change this to req.query.authCode and then change that to an encoded version of the form name or id, whatever's easier.
            let isFromServer = req.query.f9d14b6cb97d;
            if (!isFromServer) return res.json({ "error": "You are not allowed to use this endpoint" });

            try {
                let questions = await executeMysqlQuery('SELECT * FROM questions WHERE id = ?', [req.params.formId]);
                res.json(questions);
            } catch (e) {
                console.log(e)
            }
        });

        this.router.post('/submitForm/:formId', async (req, res) => {
            const formId = req.params.formId;
            let data = req.body;
            let discordId = req.session.discordId;

            if (!discordId) {
                return res.json({
                    "error": "You are not signed in."
                });
            };

            if (!data) {
                return res.json({
                    "error": "There was no data provided."
                });
            }

            await executeMysqlQuery(`INSERT INTO submissions (discord_id, form_id, submitted_at, form_data, outcome) VALUES (?, ?, ?, ?, ?)`, [discordId, formId, Math.floor(Date.now() / 1000), JSON.stringify(data), 'pending']);

            res.json({ success: true, message: 'Successfully applied!' });
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