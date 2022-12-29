const Router = require('../classes/Router');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const redirect = encodeURIComponent(`${process.env.HOSTNAME}/api/passport/callback`);

const fetch = require('node-fetch-commonjs');
const { getAvailableForms, getPreviousSubmissions, getOpenForms } = require('../utilities/formFunctions');
const { executeMysqlQuery } = require('../utilities/mysqlHelper');
const { encrypt } = require('../utilities/aes');
const { checkUserPermissions } = require('../utilities/userFunctions');
const { forceHome } = require('../..');

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
        this.router.use(function (req, res, next) {
            if (forceHome.includes(req.session.discordId)) {
                forceHome.splice(forceHome.indexOf(req.session.discordId), 1);
                return res.redirect('/');
            };

            if (req.session.isBanned === true) {
                let allowedPages = ['/logout']; // they are not allowed to access the API
                if (allowedPages.includes(req.path)) next();
                else res.redirect('/ban');
            } else {
                next();
            }
        });

        this.router.get('/', async (req, res) => {
            return res.json({ "message": "Protagnst-Secure API Loaded." });
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

            req.session.discordId = userJson.id;
            req.session.userTag = userJson.username + '#' + userJson.discriminator;

            if (!json.refresh_token) { return res.redirect('/auth'); };
            let encryptedRefreshToken = encrypt(json.refresh_token);

            // check if user exists in database
            let userExists = await executeMysqlQuery(`SELECT * FROM users WHERE discord_id = ?`, [userJson.id]);
            // if user exists, delete
            if (userExists.length > 0) {
                let userOldPermission = userExists[0].permission_level;
                let userOldBanStatus = userExists[0].is_banned;
                await executeMysqlQuery(`DELETE FROM users WHERE discord_id = ?`, [userJson.id]);
                await executeMysqlQuery(`INSERT INTO users (discord_id, refresh_token, permission_level, is_banned) VALUES (?, ?, ?, ?)`, [userJson.id, encryptedRefreshToken, userOldPermission, userOldBanStatus]);
            } else {
                await executeMysqlQuery(`INSERT INTO users (discord_id, refresh_token, permission_level, is_banned) VALUES (?, ?, ?, ?)`, [userJson.id, encryptedRefreshToken, 1, 0]);
            }

            res.set(200).redirect('/');
        });

        this.router.get('/getAvailableForms', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });
            let forms = await getAvailableForms(req);
            if (forms) return res.json(forms);
            else return res.json({ "message": "There are no forms available for you right now!" });
        });

        this.router.get('/getShownForms', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });
            let forms = await getOpenForms(req);
            if (forms) return res.json(forms);
            else return res.json({ "error": "There are no forms available for you right now!" });
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

            let perms = await checkUserPermissions(req.session.discordId);
            return res.json({ "permission_level": perms });
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

        this.router.get('/currentSubmissions/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'fdd04d8ca52b') return res.json({ "error": "You are not allowed to use this endpoint" });

            let submissions = await executeMysqlQuery(`SELECT * FROM submissions WHERE form_id = ?`, [req.params.formId]);

            if (submissions.length > 0) {
                return res.json(submissions);
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

        this.router.get('/admin/export/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != '37c14b8a8b98') return res.json({ "error": "You are not allowed to use this endpoint" });

            let submissions = await executeMysqlQuery(`SELECT * FROM submissions WHERE form_id = ?`, [req.params.formId]);
            let questions = await executeMysqlQuery(`SELECT * FROM questions WHERE id = ?`, [req.params.formId]);
            if (questions.length < 1) return res.json({ "error": "No questions on form" });

            let csvRows = [];
            let headers = Object.keys(JSON.parse(submissions[0].form_data));
            csvRows.push(headers.join(','));
            submissions.forEach(submission => {
                csvRows.push(Object.values(JSON.parse(submission.form_data)).join(','));
            });

            return res.send(csvRows.join('\n'));
        });

        this.router.post('/admin/toggleBanStatus', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'reLi3NK5asd6') return res.json({ "error": "You are not allowed to use this endpoint" });

            let userData = await executeMysqlQuery(`SELECT * FROM users WHERE discord_id = ?`, [req.body.userid]);
            if (!userData.length) return res.json({ "error": "User not found" });

            if (req.body.userid === req.session.discordId) return res.json({ "error": "You cannot ban yourself" });

            let discordData;
            let hostname = req.headers.host;
            let protocol = req.protocol;
            let url = protocol + '://' + hostname + '/api/getProfileById/' + req.body.userid + '?isFromServer=c2f64dea9444&requestId=' + req.session.discordId;
            await fetch(url).then(res => res.json()).then((data) => discordData = data);

            let discordName = discordData.username ?? `Unknown` + '#' + discordData.discriminator ?? `0000`;

            if (userData[0].is_banned) {
                await executeMysqlQuery(`UPDATE users SET is_banned = ? WHERE discord_id = ?`, [0, discordData.id]);
                return res.json({ success: true, message: `Successfully unbanned ${discordName}` });
            } else {
                await executeMysqlQuery(`UPDATE users SET is_banned = ? WHERE discord_id = ?`, [1, discordData.id]);
                return res.json({ success: true, message: `Successfully banned ${discordName}` });
            }
        });

        this.router.post('/dev/updatePermissionLevel', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'dTs54Cskv38ga1') return res.json({ "error": "You are not allowed to use this endpoint" });

            let userData = await executeMysqlQuery(`SELECT * FROM users WHERE discord_id = ?`, [req.body.userid]);
            if (!userData.length) return res.json({ "error": "User not found" });

            if (req.body.userid === req.session.discordId) return res.json({ "error": "You cannot change your own permissions" });

            let discordData;
            let hostname = req.headers.host;
            let protocol = req.protocol;
            let url = protocol + '://' + hostname + '/api/getProfileById/' + req.body.userid + '?isFromServer=c2f64dea9444&requestId=' + req.session.discordId;
            await fetch(url).then(res => res.json()).then((data) => discordData = data);

            let discordName = discordData.username ?? `Unknown` + '#' + discordData.discriminator ?? `0000`;

            await executeMysqlQuery(`UPDATE users SET permission_level = ? WHERE discord_id = ?`, [req.body.newPerms, discordData.id]);
            return res.json({ success: true, message: `Successfully updated ${discordName}'s permission level.\nWas: ${userData[0].permission_level} | Now: ${req.body.newPerms}` });
        });

        this.router.post('/dev/createNewForm', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'joRP228zYm213g') return res.json({ "error": "You are not allowed to use this endpoint" });

            let formName = req.body.formName;
            let formDescription = req.body.formDescription;
            let formPerms = req.body.formPerms;
            let formShown = req.body.formShown;
            let formMaxResponses = req.body.formMaxResponses;

            let nfData = await executeMysqlQuery(`INSERT INTO forms (form_name, form_description, permissions_needed, is_hidden, max_responses) VALUES (?, ?, ?, ?, ?)`, [formName, formDescription, formPerms, formShown, formMaxResponses]);

            return res.json({ success: true, message: `A new form was successfully created.\nName: ${formName}\nID: ${nfData.insertId}` });
        });

        this.router.post('/dev/createNewQuestion', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'QAhjCCfzedT4Yh') return res.json({ "error": "You are not allowed to use this endpoint" });

            let formId = req.body.formId;
            let questionShort = req.body.questionShort;
            let questionType = req.body.questionType;
            let questionText = req.body.questionText;
            let questionData = req.body.questionData;

            let nfData = await executeMysqlQuery(`INSERT INTO questions (id, question, question_short, question_type, question_data) VALUES (?, ?, ?, ?, ?)`, [formId, questionText, questionShort, questionType, questionData]);
            
            return res.json({ success: true, message: `A new question was successfully created.\nForm ID: ${formId}\nQuestion ID: ${nfData.insertId}` });
        });

        this.router.get('/dev/getAllForms', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'ixwAW5LXGTjgG') return res.json({ "error": "You are not allowed to use this endpoint" });

            let forms = await executeMysqlQuery(`SELECT * FROM forms`);
            return res.json(forms);
        });

        this.router.post('/dev/toggleFormVis', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'ixVu6veCBqpasc42') return res.json({ "error": "You are not allowed to use this endpoint" });

            let formData = await executeMysqlQuery(`SELECT * FROM forms WHERE id = ?`, [req.body.formid]);
            if (!formData.length) return res.json({ "error": "Form not found" });

            if (formData[0].is_hidden) {
                await executeMysqlQuery(`UPDATE forms SET is_hidden = ? WHERE id = ?`, [0, req.body.formid]);
                return res.json({ success: true, message: `Successfully marked ${formData[0].form_name} as shown!` });
            } else {
                forceHome.push(req.body.userid);
                await executeMysqlQuery(`UPDATE forms SET is_hidden = ? WHERE id = ?`, [1, req.body.formid]);
                return res.json({ success: true, message: `Successfully marked ${formData[0].form_name} as hidden!` });
            }
        });

        this.router.get('/getProfileById/:discordId', async (req, res) => {
            if (!req.session.discordId && !req.query.requestId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'c2f64dea9444') return res.json({ "error": "You are not allowed to use this endpoint" });

            const response = await fetch(`https://discord.com/api/v10/users/${req.params.discordId}`, {
                headers: {
                    Authorization: `Bot ${process.env.BOT_TOKEN}`
                }
            });

            if (response.status !== 200) return res.json({ "error": "User not found" });
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