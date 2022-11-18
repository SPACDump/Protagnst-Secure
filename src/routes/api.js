const Router = require('../classes/Router');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const redirect = encodeURIComponent(`${process.env.HOSTNAME}/api/passport/callback`);

const fetch = require('node-fetch-commonjs');
const { getAvailableForms, getPreviousSubmissions } = require('../utilities/formFunctions');
const { executeMysqlQuery } = require('../utilities/mysqlHelper');
const { encrypt } = require('../utilities/aes');

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
                'redirect_uri': `${process.env.HOSTNAME}/api/passport/callback`,
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

            let encryptedRefreshToken = encrypt(json.refresh_token);

            // check if user exists in database
            let userExists = await executeMysqlQuery(`SELECT * FROM users WHERE discord_id = ?`, [userJson.id]);
            // if user exists, delete
            if (userExists.length > 0) {
                let userOldPermission = userExists[0].permission_level;
                await executeMysqlQuery(`DELETE FROM users WHERE discord_id = ?`, [userJson.id]);
                await executeMysqlQuery(`INSERT INTO users (discord_id, refresh_token, permission_level) VALUES (?, ?, ?)`, [userJson.id, encryptedRefreshToken, userOldPermission]);
            } else {
                await executeMysqlQuery(`INSERT INTO users (discord_id, refresh_token, permission_level) VALUES (?, ?, ?)`, [userJson.id, encryptedRefreshToken, 1]);
            }

            res.set(200).redirect('/');
        });

        this.router.get('/getAvailableForms', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });
            let forms = await getAvailableForms(req);
            if (forms) return res.json(forms);
            else return res.json({ "message": "There are no forms available for you right now!" });
        });

        this.router.get('/getPreviousSubmissions', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });
            let submissions = await getPreviousSubmissions(req);
            if (submissions) return res.json(submissions);
            else return res.json({ "message": "There are no (available) submissions for you to view!" });
        });

        this.router.get('/getFormById/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'abc54fc6a01a') return res.json({ "error": "You are not allowed to use this endpoint" });

            let form = await executeMysqlQuery(`SELECT * FROM forms WHERE id = ?`, [req.params.formId]);

            if (form.length > 0) {
                let questions = await executeMysqlQuery(`SELECT * FROM questions WHERE id = ?`, [req.params.formId]);
                let formObj = {
                    "form": form[0],
                    "questions": questions
                }
                return res.json(formObj);
            } else {
                return res.json({ "error": "Form not found" });
            }
        });

        this.router.get('/getSubmission/:submissionId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            // @todo: Add "If user is staff (level 99+), allow it"
            if (isFromServer != 'f1424090948c') return res.json({ "error": "You are not allowed to use this endpoint" });

            let submission = await executeMysqlQuery(`SELECT * FROM submissions WHERE submission_id = ?`, [req.params.submissionId]);

            if (submission[0].discord_id != req.session.discordId) return res.json({ "error": "You are not allowed to view this submission" });

            if (submission.length > 0) {
                let combinedObj = {
                    "submission": submission[0],
                    "answers": submission[0].form_data
                }

                return res.json(combinedObj);
            } else {
                return res.json({ "error": "Submission not found" });
            };

        });

        this.router.get('/fetchUserPerms/:discordId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != '170c455e9a4a') return res.json({ "error": "You are not allowed to use this endpoint" });

            if (req.session.discordId != req.params.discordId) return res.json({ "error": "You are not allowed to view this user's permissions" });

            let user = await executeMysqlQuery(`SELECT * FROM users WHERE discord_id = ?`, [req.params.discordId]);

            if (user.length > 0) {
                return res.json({ "permission_level": user[0].permission_level });
            } else {
                return res.json({ "error": "User not found" });
            }
        });

        this.router.get('/currentResponses/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'fdd04d8ca52b') return res.json({ "error": "You are not allowed to use this endpoint" });

            let submissions = await executeMysqlQuery(`SELECT * FROM submissions WHERE form_id = ?`, [req.params.formId]);

            if (submissions.length > 0) {
                return res.json(submissions.length);
            } else {
                return res.json({ "error": "No submissions found" });
            }
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

        this.router.get('/admin/getOpenApplications', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != '37c14b8a8b98') return res.json({ "error": "You are not allowed to use this endpoint" });

            let submissions = await executeMysqlQuery(`SELECT * FROM submissions WHERE outcome = ?`, ['pending']);

            if (submissions.length > 0) {
                return res.json(submissions);
            } else {
                return res.json({ "error": "No submissions found" });
            }
        });

        this.router.get('/getProfileById/:discordId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'c2f64dea9444') return res.json({ "error": "You are not allowed to use this endpoint" });

            const response = await fetch(`https://discord.com/api/v10/users/${req.params.discordId}`, {
                headers: {
                    Authorization: `Bot ${process.env.BOT_TOKEN}`
                }
            });

            if (!response.ok) return res.json({ "error": "User not found" });
            return res.json(await response.json());
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