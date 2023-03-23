const Router = require('../classes/Router');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const redirect = encodeURIComponent(`${process.env.HOSTNAME}/api/passport/callback`);

const fetch = require('node-fetch-commonjs');
const { getAvailableForms, getPreviousSubmissions, getOpenForms, getFormById } = require('../utilities/formFunctions');
const { executeMysqlQuery } = require('../utilities/mysqlHelper');
const { encrypt, decrypt } = require('../utilities/aes');
const { checkUserPermissions, refreshAccessToken, putUserInGuild } = require('../utilities/userFunctions');
const { forceHome } = require('../..');

require('dotenv').config();

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
        this.router.use(async function (req, res, next) {
            if (forceHome.includes(req.session.discordId)) {
                forceHome.splice(forceHome.indexOf(req.session.discordId), 1);
                return res.redirect('/');
            };

            if (req.session.isBanned === true) {
                let allowedPages = ['/logout']; // they are not allowed to access the API
                if (allowedPages.includes(req.path)) next();
                else res.redirect('/ban');
            };

            let dontLog = false;
            // if the req path starts with anything from logArray, dont log it
            let logArray = ["/fetchUserPerms", "/getAvailableForms", "/admin/graph"];
            for (let i = 0; i < logArray.length; i++) {
                if (req.path.startsWith(logArray[i])) dontLog = true;
            };

            if (req.session.userId && !dontLog) await executeMysqlQuery(`INSERT INTO requests (user_id, page, time) VALUES (?, ?, ?)`, [req.session.userId, `/api` + req.path, Math.floor(Date.now()/1000)]);
            return next();
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
            let userExists = await executeMysqlQuery(`SELECT * FROM users WHERE disc = ?`, [userJson.id]);
            // if user exists, update the record
            if (userExists.length > 0) {
                let userOldPermission = userExists[0].perms;
                let userOldBanStatus = userExists[0].is_banned;
                let userOldMCName = userExists[0].mc || null;
                req.session.mcName = userOldMCName;
                req.session.userId = userExists[0].id;
                await executeMysqlQuery(`UPDATE users SET mc=?, refresh=?, perms=?, is_banned=? WHERE disc = ?`, [userOldMCName, encryptedRefreshToken, userOldPermission, userOldBanStatus, userJson.id]);
            } else {
                await executeMysqlQuery(`INSERT INTO users (disc, refresh, perms, is_banned) VALUES (?, ?, ?, ?)`, [userJson.id, encryptedRefreshToken, 1, 0]);
                let uid = await executeMysqlQuery(`SELECT id FROM users WHERE disc = ?`, [userJson.id]);
                req.session.userId = uid[0].id;
            };

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
                let questions = await executeMysqlQuery(`SELECT * FROM questions WHERE form_id = ?`, [req.params.formId]);
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

            let submission = await executeMysqlQuery(`SELECT * FROM submissions WHERE id = ?`, [req.params.submissionId]);

            let userPerms = await checkUserPermissions(req.session.discordId);
            if (submission[0].user_id != req.session.userId && userPerms < 3) return res.json({ "error": "You are not allowed to view this submission" });

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
            return res.json({ "perms": perms });
        });

        this.router.get('/currentResponses/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'fdd04d8ca52b') return res.json({ "error": "You are not allowed to use this endpoint" });

            const result = await executeMysqlQuery(`SELECT COUNT(*) as count FROM submissions WHERE form_id = ?`, [req.params.formId]);
            const count = result[0].count;

            if (count > 0) {
                return res.json(count);
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

        this.router.get('/getQuestions/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.f9d14b6cb97d;
            if (!isFromServer) return res.json({ "error": "You are not allowed to use this endpoint" });

            try {
                let questions = await executeMysqlQuery('SELECT * FROM questions WHERE form_id = ?', [req.params.formId]);
                res.json(questions);
            } catch (e) {
                res.json({ error: true, message: "There was an error with the database query." })
                console.log(e)
            }
        });

        this.router.post('/submitForm/:formId', async (req, res) => {
            const formId = req.params.formId;
            let data = req.body;
            let userId = req.session.userId;

            if (!req.session.discordId) {
                return res.json({
                    "error": "You are not signed in."
                });
            };

            if (!userId) {
                return res.json({
                    "error": "Your account was not found."
                })
            }

            if (!data) {
                return res.json({
                    "error": "There was no data provided."
                });
            }

            await executeMysqlQuery(`INSERT INTO submissions (form_id, user_id, time, data, outcome) VALUES (?, ?, ?, ?, ?)`, [formId, userId, Math.floor(Date.now() / 1000), JSON.stringify(data), 'pending']);
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

        this.router.get('/admin/getFormStats/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != '37c14b8a8b98') return res.json({ "error": "You are not allowed to use this endpoint" });

            // get form info to make sure it's active & exists
            let formData = await getFormById(req.params.formId);
            if (!formData) return res.json({ "error": "Form not found" });

            let formId = req.params.formId;

            let submissions = await executeMysqlQuery(`SELECT IFNULL(COUNT(submissions.id), 0) as current_responses, forms.max_responses FROM forms LEFT JOIN submissions ON forms.id = submissions.form_id WHERE forms.id = ? GROUP BY forms.id;`, [formId]);
            if (submissions.length > 1) return res.json({ "error": "Too many submissions found" });
            else if (submissions.length < 1) return res.json({ "error": "No submissions found" });

            let currentResponses = submissions[0].current_responses;
            let maxResponses = submissions[0].max_responses;
            let latestResponse = await executeMysqlQuery(`SELECT * FROM submissions WHERE form_id = ? ORDER BY time DESC LIMIT 1`, [formId]);
            let userId = latestResponse[0].user_id;
            let user = await executeMysqlQuery(`SELECT * FROM users WHERE id = ?`, [userId]);
            let discordID = user[0].disc;

            let response = {
                "success": true,
                "current_responses": currentResponses,
                "max_responses": maxResponses == -1 ? "∞" : maxResponses
            }

            // if last response exists, add it to the response
            if (latestResponse.length > 0) {
                response.newest_response = latestResponse[0].time;
                response.newest_response_user = latestResponse[0].user_id;
                response.newest_response_outcome = latestResponse[0].outcome;
                response.discordID = discordID;
            }

            return res.json(response);
        });

        this.router.get('/admin/allFormStats', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != '37c14b8a8b98') return res.json({ "error": "You are not allowed to use this endpoint" });

            let sql = `SELECT COUNT(submissions.form_id) AS current_responses, forms.max_responses, forms.id AS form_id FROM forms LEFT JOIN submissions ON forms.id = submissions.form_id GROUP BY forms.id;`;

            let submissions = await executeMysqlQuery(sql);
            if (submissions.length < 1) return res.json({ "error": "No submissions found" });

            let response = {
                "success": true,
                "forms": submissions
            };

            return res.json(response);
        });

        this.router.get('/admin/graph/24requests', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != '37c14b8a8b98') return res.json({ "error": "You are not allowed to use this endpoint" });

            let resu = await executeMysqlQuery(`SELECT * FROM requests WHERE time >= UNIX_TIMESTAMP(NOW() - INTERVAL 24 HOUR)`)
            return res.json(resu);
        });

        this.router.get('/admin/export/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != '37c14b8a8b98') return res.json({ "error": "You are not allowed to use this endpoint" });

            let submissions = await executeMysqlQuery(`SELECT * FROM submissions WHERE form_id = ?`, [req.params.formId]);
            let questions = await executeMysqlQuery(`SELECT * FROM questions WHERE form_id = ?`, [req.params.formId]);
            if (questions.length < 1) return res.json({ "error": "No questions on form" });

            let csvRows = [];
            let headers = Object.keys(JSON.parse(submissions[0].form_data));
            csvRows.push(headers.join(','));
            submissions.forEach(submission => {
                csvRows.push(Object.values(JSON.parse(submission.form_data)).join(','));
            });

            return res.send(csvRows.join('\n'));
        });

        this.router.post('/admin/accept/:submissionArray', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.body.ahM9WEXF79G;
            if (!isFromServer) return res.json({ "error": "You are not allowed to use this endpoint" });

            let submissionArray = req.params.submissionArray.split(',');
            submissionArray = submissionArray.filter((item, index) => submissionArray.indexOf(item) === index);
            submissionArray.sort((a, b) => a - b);

            function sleep(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }

            for (let i = 0; i < submissionArray.length; i++) {
                let submission = await executeMysqlQuery(`SELECT * FROM submissions WHERE id = ?`, [submissionArray[i]]);
                if (!submission.user_id) continue;

                let userId = submission[0].user_id;
                let userData = await executeMysqlQuery(`SELECT * FROM users WHERE id = ?`, [userId]);
                if (!userData.id) continue;

                let refreshToken = decrypt(userData[0].refresh);
                let accessToken = await refreshAccessToken(refreshToken, userData[0].disc);

                await executeMysqlQuery(`UPDATE submissions SET outcome = ? WHERE id = ?`, ['accepted', submissionArray[i]]);

                let roles = [];
                roles.push(process.env.PARTICIPANT_ROLE_ID);

                await putUserInGuild(accessToken, userData[0].disc, process.env.GUILD_ID, roles);
                await sleep(1000);
            };

            return res.json({ success: true, message: `${submissionArray.length} submission${submissionArray.length > 1 ? `s have` : ` has`} been marked as accepted!\nSubmissions: ${submissionArray.join(", ")}` });
        });

        this.router.post('/admin/deny/:submissionArray', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.body.ahM9WEXF79G;
            if (!isFromServer) return res.json({ "error": "You are not allowed to use this endpoint" });

            let submissionArray = req.params.submissionArray.split(',');
            submissionArray = submissionArray.filter((item, index) => submissionArray.indexOf(item) === index);
            submissionArray.sort((a, b) => a - b);

            function sleep(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }

            for (let i = 0; i < submissionArray.length; i++) {
                let submission = await executeMysqlQuery(`SELECT * FROM submissions WHERE id = ?`, [submissionArray[i]]);
                if (!submission) continue;

                await executeMysqlQuery(`UPDATE submissions SET outcome = ? WHERE id = ?`, ['denied', submissionArray[i]]);
                await sleep(1200);
            };

            return res.json({ success: true, message: `${submissionArray.length} submission${submissionArray.length > 1 ? `s have` : ` has`} been marked as denied!\nSubmissions: ${submissionArray.join(", ")}` });
        });

        this.router.post('/admin/pending/:submissionArray', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.body.ahM9WEXF79G;
            if (!isFromServer) return res.json({ "error": "You are not allowed to use this endpoint" });

            let submissionArray = req.params.submissionArray.split(',');
            submissionArray = submissionArray.filter((item, index) => submissionArray.indexOf(item) === index);
            submissionArray.sort((a, b) => a - b);

            function sleep(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }

            for (let i = 0; i < submissionArray.length; i++) {
                let submission = await executeMysqlQuery(`SELECT * FROM submissions WHERE id = ?`, [submissionArray[i]]);
                if (!submission) continue;

                await executeMysqlQuery(`UPDATE submissions SET outcome = ? WHERE id = ?`, ['pending', submissionArray[i]]);
                await sleep(1200);
            };

            return res.json({ success: true, message: `${submissionArray.length} submission${submissionArray.length > 1 ? `s have` : ` has`} been marked as pending!\nSubmissions: ${submissionArray.join(", ")}` });
        });

        this.router.post('/admin/toggleBanStatus', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'reLi3NK5asd6') return res.json({ "error": "You are not allowed to use this endpoint" });

            let userData = await executeMysqlQuery(`SELECT * FROM users WHERE disc = ?`, [req.body.userid]);
            if (!userData.length) return res.json({ "error": "User not found" });

            if (req.body.userid === req.session.discordId) return res.json({ "error": "You cannot ban yourself" });

            let discordData;
            let url = process.env.HOSTNAME + '/api/getProfileById/' + req.body.userid + '?isFromServer=c2f64dea9444&requestId=' + req.session.discordId;
            await fetch(url).then(res => res.json()).then((data) => discordData = data);

            // discord username and discriminator
            let discordName = discordData.username + '#' + discordData.discriminator;

            if (userData[0].is_banned) {
                await executeMysqlQuery(`UPDATE users SET is_banned = ? WHERE disc = ?`, [0, discordData.id]);
                return res.json({ success: true, message: `Successfully unbanned ${discordName}` });
            } else {
                forceHome.push(req.body.userid);
                await executeMysqlQuery(`UPDATE users SET is_banned = ? WHERE disc = ?`, [1, discordData.id]);
                return res.json({ success: true, message: `Successfully banned ${discordName}` });
            }
        });

        this.router.post('/dev/updatePermissionLevel', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'dTs54Cskv38ga1') return res.json({ "error": "You are not allowed to use this endpoint" });

            let userData = await executeMysqlQuery(`SELECT * FROM users WHERE disc = ?`, [req.body.userid]);
            if (!userData.length) return res.json({ "error": "User not found" });

            if (req.body.userid === req.session.discordId) return res.json({ "error": "You cannot change your own permissions" });

            let discordData;
            let url = process.env.HOSTNAME + '/api/getProfileById/' + req.body.userid + '?isFromServer=c2f64dea9444&requestId=' + req.session.discordId;
            await fetch(url).then(res => res.json()).then((data) => discordData = data);

            let discordName = discordData.username ?? `Unknown` + '#' + discordData.discriminator ?? `0000`;

            await executeMysqlQuery(`UPDATE users SET perms = ? WHERE disc = ?`, [req.body.newPerms, discordData.id]);
            return res.json({ success: true, message: `Successfully updated ${discordName}'s permission level.\nWas: ${userData[0].perms} | Now: ${req.body.newPerms}` });
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

            let nfData = await executeMysqlQuery(`INSERT INTO forms (name, \`desc\`, perms, is_hidden, max_responses) VALUES (?, ?, ?, ?, ?)`, [formName, formDescription, formPerms, formShown, formMaxResponses]);

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

            let nfData = await executeMysqlQuery(`INSERT INTO questions (form_id, question, short_id, type, data) VALUES (?, ?, ?, ?, ?)`, [formId, questionText, questionShort, questionType, questionData]);

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
                return res.json({ success: true, message: `Successfully marked ${formData[0].name} as shown!` });
            } else {
                forceHome.push(req.body.userid);
                await executeMysqlQuery(`UPDATE forms SET is_hidden = ? WHERE id = ?`, [1, req.body.formid]);
                return res.json({ success: true, message: `Successfully marked ${formData[0].name} as hidden!` });
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

        this.router.post('/user/setminecraft', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.body.SWAZg59PN7oS3;
            if (!isFromServer) return res.json({ "error": "You are not allowed to use this endpoint" });

            let minecraftName = req.body.mcName;
            if (!minecraftName) return res.json({ "error": "You did not provide a Minecraft name" });

            await executeMysqlQuery(`UPDATE users SET mc = ? WHERE disc = ?`, [minecraftName, req.session.discordId]);
            req.session.mcName = minecraftName;
            return res.json({ success: true, message: `Your Minecraft name was successfully updated to ${minecraftName}` });
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