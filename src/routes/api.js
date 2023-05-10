// Require packages
const Router = require('../classes/Router');

// Setup the process.env handler
require('dotenv').config();

// Make a variable for the needed environment variables
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const redirect = encodeURIComponent(`${process.env.HOSTNAME}/api/passport/callback`);

// Fetch my functions & some packages
const fetch = require('node-fetch-commonjs');
const { getAvailableForms, getPreviousSubmissions, getOpenForms, getFormById } = require('../utilities/formFunctions');
const { executeMysqlQuery } = require('../utilities/mysqlHelper');
const { encrypt, decrypt } = require('../utilities/aes');
const { checkUserPermissions, refreshAccessToken, putUserInGuild } = require('../utilities/userFunctions');
const { forceHome } = require('../../index');

// Function to encode the url data into a sendable format
// This is required for sending a bunch of data to Discord when requesting an access token
function _encode(obj) {
    let string = "";

    for (const [key, value] of Object.entries(obj)) {
        if (!value) continue;
        string += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }

    return string.substring(1);
}

// Setup the API as a router
class API extends Router {
    constructor(client) {
        // Set the path to /api
        super(client, '/api');
    }
    // Mark the route and start creating endpoints
    createRoute() {
        // Middleware:
        // Similar to the App.js middleware
        this.router.use(async function (req, res, next) {
            // Check if the user needs to be redirected to the home page
            if (forceHome.includes(req.session.discordId)) {
                forceHome.splice(forceHome.indexOf(req.session.discordId), 1);
                return res.redirect('/');
            };

            // Check if the user is banned
            if (req.session.isBanned === true) {
                let allowedPages = ['/logout']; // they are not allowed to access the API - other than logging out
                if (allowedPages.includes(req.path)) next();
                else res.redirect('/ban');
            };

            // Check if the request needs to be logged
            let dontLog = false;
            // if the req path starts with anything from logArray, dont log it
            let logArray = ["/fetchUserPerms", "/getAvailableForms", "/admin/graph"];
            for (let i = 0; i < logArray.length; i++) {
                if (req.path.startsWith(logArray[i])) dontLog = true;
            };

            // next() moves on to the requested endpoint
            if (!req.session || !req.session.userId) return next();
            if (req.session.userId && !dontLog) await executeMysqlQuery(`INSERT INTO requests (user_id, page, time) VALUES (?, ?, ?)`, [req.session.userId, `/api` + req.path, Math.floor(Date.now()/1000)]);
            return next();
        });

        // Basic entry page because no actual data is stored here
        this.router.get('/', async (req, res) => {
            return res.json({ "message": "Protagnst-Secure API Loaded." });
        });

        // Redirect to the Discord OAuth2 page
        this.router.get('/passport', (req, res) => {
            res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&scope=identify%20email%20guilds.join&response_type=code&redirect_uri=${redirect}`);
        });

        // Callback for the Discord OAuth2 page - this is where the user is redirected to after authorizing the app on Discord
        this.router.get('/passport/callback', async (req, res) => {
            // Get code from Discord, if no code, discord did not send them here.
            if (!req.query.code) return res.redirect('/auth');
            const code = req.query.code;

            // Setup the data to send to Discord, to get the access token & user data
            let urlData = {
                'client_id': CLIENT_ID,
                'client_secret': CLIENT_SECRET,
                'grant_type': 'authorization_code',
                'code': code,
                'redirect_uri': `${process.env.HOSTNAME}/api/passport/callback`,
                'scope': 'identify%20email%20guilds.join'
            };

            // Encode the data into a sendable format
            let params = _encode(urlData);

            // Get access token from Discord
            let response = await fetch(`https://discord.com/api/oauth2/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: params
            });
            // Make it into JSON, so I can manipulate it
            const json = await response.json();

            // Get the user's name/data
            let userResponse = await fetch(`https://discord.com/api/v10/users/@me`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${json.access_token}`
                }
            });
            // Make it into JSON, so I can manipulate it
            const userJson = await userResponse.json();

            // Set the user name as a session variable
            req.session.discordId = userJson.id;
            req.session.userTag = userJson.username + '#' + userJson.discriminator;

            // If the refresh token didn't get sent, then it's a broken response
            if (!json.refresh_token) { return res.redirect('/auth'); };
            let encryptedRefreshToken = encrypt(json.refresh_token);

            // check if user exists in database
            let userExists = await executeMysqlQuery(`SELECT * FROM users WHERE disc = ?`, [userJson.id]);
            // if user exists, update the record
            if (userExists.length > 0) {
                let userOldPermission = userExists[0].perms;
                let userOldBanStatus = userExists[0].is_banned;
                let userOldMCName = userExists[0].mc || null;
                // Set current user data to session variables
                req.session.mcName = userOldMCName;
                req.session.userId = userExists[0].id;
                // Update the user's data in the database
                await executeMysqlQuery(`UPDATE users SET mc=?, refresh=?, perms=?, is_banned=? WHERE disc = ?`, [userOldMCName, encryptedRefreshToken, userOldPermission, userOldBanStatus, userJson.id]);
            } else {
                // Create a new record for the user
                await executeMysqlQuery(`INSERT INTO users (disc, refresh, perms, is_banned) VALUES (?, ?, ?, ?)`, [userJson.id, encryptedRefreshToken, 1, 0]);
                let uid = await executeMysqlQuery(`SELECT id FROM users WHERE disc = ?`, [userJson.id]);
                // Set user id as a session variable
                req.session.userId = uid[0].id;
            };

            // All done! Redirect to the home page
            res.set(200).redirect('/');
        });

        // Endpoint to get the open forms for the user
        this.router.get('/getAvailableForms', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });
            // For most endpoints like this:
            // Use the external function, defined at the top of this file, and return the data in the form of a json response
            let forms = await getAvailableForms(req);
            if (forms) return res.json(forms);
            else return res.json({ "message": "There are no forms available for you right now!" });
        });

        // Get forms for the user, difference here is it also shows the ones they've already submitted
        this.router.get('/getShownForms', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });
            let forms = await getOpenForms(req);
            if (forms) return res.json(forms);
            else return res.json({ "error": "There are no forms available for you right now!" });
        });

        // Get the user's previous submissions
        this.router.get('/getPreviousSubmissions', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });
            let submissions = await getPreviousSubmissions(req);
            if (submissions) return res.json(submissions);
            else return res.json({ "message": "There are no (available) submissions for you to view!" });
        });

        // Get the a form's data by its ID
        this.router.get('/getFormById/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            // Used in most endpoints:
            // This is a fairly hacky way of making sure the request is coming from the server, and not from a user
            // We only tell the HTML page that needs to access this endpoint the secret, so if it's not there, it's not from the server
            // In a future update, this will be replaced with environment api keys, and page path checking
            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'abc54fc6a01a') return res.json({ "error": "You are not allowed to use this endpoint" });

            let form = await executeMysqlQuery(`SELECT * FROM forms WHERE id = ?`, [req.params.formId]);

            // Sanitise the data and return it
            if (form.length > 0) {
                let questions = await executeMysqlQuery(`SELECT * FROM questions WHERE form_id = ?`, [req.params.formId]);
                let formObj = {
                    "form": form[0],
                    "questions": questions
                }
                return res.json(formObj);
            } else {
                // The form wasn't found
                return res.json({ "error": "Form not found" });
            }
        });

        // Get a submission's data by its ID
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

        // Get the permission level of a user, used on many pages to ensure a user is allowed to view the content
        this.router.get('/fetchUserPerms/:discordId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != '170c455e9a4a') return res.json({ "error": "You are not allowed to use this endpoint" });

            if (req.session.discordId != req.params.discordId) return res.json({ "error": "You are not allowed to view this user's permissions" });

            let perms = await checkUserPermissions(req.session.discordId);
            return res.json({ "perms": perms });
        });

        // Get the current responses for a form
        this.router.get('/currentResponses/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'fdd04d8ca52b') return res.json({ "error": "You are not allowed to use this endpoint" });

            // Setup aggregate query to get the count of submissions for the form id that has been requested
            const result = await executeMysqlQuery(`SELECT COUNT(*) as count FROM submissions WHERE form_id = ?`, [req.params.formId]);
            const count = result[0].count;

            if (count > 0) {
                // If the count is a number, return it
                return res.json(count);
            } else {
                // It probably was an empty array, or some random broken data
                return res.json({ "error": "No submissions found" });
            }
        });

        // Similar to the above endpoint, but get the entire response data rather than just counting if it's there.
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

        // Logout - destroy the session, unset all variables and then the app automatically redirects them to the login page.
        this.router.get('/logout', (req, res) => {
            req.session.destroy();
            res.redirect('/');
        });

        // Get questions for a form
        this.router.get('/getQuestions/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.f9d14b6cb97d;
            if (!isFromServer) return res.json({ "error": "You are not allowed to use this endpoint" });

            // Inconsistency in the code:
            // Sometimes I use trycatches and handle the exception, other times I leave it and try to handle broken data on the other end.
            // In future updates, I plan to make this more consistent and handle the exceptions in the same way every time
            // Also, I plan to make the error messages more consistent, and use consistent error codes
            try {
                let questions = await executeMysqlQuery('SELECT * FROM questions WHERE form_id = ?', [req.params.formId]);
                res.json(questions);
            } catch (e) {
                res.json({ error: true, message: "There was an error with the database query." })
                console.log(e)
            }
        });

        // Using the collected data from the client, submit a response to a form by a user.
        this.router.post('/submitForm/:formId', async (req, res) => {
            const formId = req.params.formId;
            let data = req.body;
            let userId = req.session.userId;

            // Check if a user and their correct data exists
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

            // Store the submission in the correct way, with additional logging data
            await executeMysqlQuery(`INSERT INTO submissions (form_id, user_id, time, data, outcome) VALUES (?, ?, ?, ?, ?)`, [formId, userId, Math.floor(Date.now() / 1000), JSON.stringify(data), 'pending']);
            // This is what I intend to do in future updates:
            // Have toasts on the client that display this responses "message" property
            // and have the toast change color based on status: "success" or "error" or "warning" or "info"
            res.json({ success: true, message: 'Successfully applied!' });
        });

        // Get all open submissions that have not yet been replied to.
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

        // Get the statistics for a form
        this.router.get('/admin/getFormStats/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != '37c14b8a8b98') return res.json({ "error": "You are not allowed to use this endpoint" });

            // get form info to make sure it's active & exists
            let formData = await getFormById(req.params.formId);
            if (!formData) return res.json({ "error": "Form not found" });

            let formId = req.params.formId;

            // This query does the following:
            // Count the number of submissions for a form, if it's null set it to 0
            // Get the max responses for a form
            // Join tables, group submissions by form id so we can count them
            let submissions = await executeMysqlQuery(`SELECT IFNULL(COUNT(submissions.id), 0) as current_responses, forms.max_responses FROM forms LEFT JOIN submissions ON forms.id = submissions.form_id WHERE forms.id = ? GROUP BY forms.id;`, [formId]);
            if (submissions.length > 1) return res.json({ "error": "Too many submissions found" });
            else if (submissions.length < 1) return res.json({ "error": "No submissions found" });

            let skipUser = false;
            let currentResponses = submissions[0].current_responses;
            let maxResponses = submissions[0].max_responses;

            // Check if the form has a new response, and display info about the user who submitted it
            let latestResponse = await executeMysqlQuery(`SELECT * FROM submissions WHERE form_id = ? ORDER BY time DESC LIMIT 1`, [formId]);
            let userId = latestResponse[0]?.user_id;
            if (!userId) skipUser = true;

            // Get the user who submitted, because we found data
            let user, discordID;
            if (!skipUser) {
                user = await executeMysqlQuery(`SELECT * FROM users WHERE id = ?`, [userId]);
                discordID = user[0].disc;
            }

            // Build a basic response
            let response = {
                "success": true,
                "current_responses": currentResponses,
                "max_responses": maxResponses == -1 ? "∞" : maxResponses
            }

            // if last response exists, add it to the response data
            if (latestResponse.length > 0 && user && discordID) {
                response.newest_response = latestResponse[0].time;
                response.newest_response_user = latestResponse[0].user_id;
                response.newest_response_outcome = latestResponse[0].outcome;
                response.discordID = discordID;
            }

            // Send back to client
            return res.json(response);
        });

        // Get all form statistics
        this.router.get('/admin/allFormStats', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != '37c14b8a8b98') return res.json({ "error": "You are not allowed to use this endpoint" });

            // Aggregate query for stats on all forms
            let sql = `SELECT COUNT(submissions.form_id) AS current_responses, forms.max_responses, forms.id AS form_id FROM forms LEFT JOIN submissions ON forms.id = submissions.form_id GROUP BY forms.id;`;

            let submissions = await executeMysqlQuery(sql);
            if (submissions.length < 1) return res.json({ "error": "No submissions found" });

            let response = {
                "success": true,
                "forms": submissions
            };

            return res.json(response);
        });

        // Get a list of requests made in the last 24 hours
        this.router.get('/admin/graph/24requests', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != '37c14b8a8b98') return res.json({ "error": "You are not allowed to use this endpoint" });

            let resu = await executeMysqlQuery(`SELECT * FROM requests WHERE time >= UNIX_TIMESTAMP(NOW() - INTERVAL 24 HOUR)`)
            return res.json(resu);
        });

        // Select the data and build a CSV file, do not download/add file buffers/types as this is done client-side for sake of performance and sanity
        this.router.get('/admin/export/:formId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != '37c14b8a8b98') return res.json({ "error": "You are not allowed to use this endpoint" });

            // Get data about submissions and questions for the csv content
            let submissions = await executeMysqlQuery(`SELECT * FROM submissions WHERE form_id = ?`, [req.params.formId]);
            let questions = await executeMysqlQuery(`SELECT * FROM questions WHERE form_id = ?`, [req.params.formId]);
            if (questions.length < 1) return res.json({ "error": "No questions on form" });

            // Setup data and make a 2d array - questions along the top and each row (top to bottom) is a unique submission
            // In the future, I'll add checks because at the moment it assumes all questions were answered - which might not always be the case
            let csvRows = [];
            let headers = Object.keys(JSON.parse(submissions[0].form_data));
            csvRows.push(headers.join(','));
            submissions.forEach(submission => {
                csvRows.push(Object.values(JSON.parse(submission.form_data)).join(','));
            });

            return res.send(csvRows.join('\n'));
        });

        // The next 3 requests control the status of a form.
        // Accepting a user places them in a discord server, and setting a submission otherwise just updates the form, nothing else.
        this.router.post('/admin/accept/:submissionArray', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.body.ahM9WEXF79G;
            if (!isFromServer) return res.json({ "error": "You are not allowed to use this endpoint" });

            // This can be a bulk request, so we need to split the list and remove duplicates
            let submissionArray = req.params.submissionArray.split(',');
            submissionArray = submissionArray.filter((item, index) => submissionArray.indexOf(item) === index);
            submissionArray.sort((a, b) => a - b);

            // We should only make 1 request at a time, so we'll loop through each submission and accept them 1 by 1 with a second delay
            function sleep(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }

            for (let i = 0; i < submissionArray.length; i++) {
                let submission = await executeMysqlQuery(`SELECT * FROM submissions WHERE id = ?`, [submissionArray[i]]);
                if (!submission.length || !submission) continue;
                submission = JSON.stringify(submission[0]);
                let userID = JSON.parse(submission).user_id;
                if (!userID) continue;

                let userData = await executeMysqlQuery(`SELECT * FROM users WHERE id = ?`, [userID]);
                userData = JSON.stringify(userData[0]);
                userData = {
                    disc: JSON.parse(userData).disc,
                    refresh: JSON.parse(userData).refresh
                }
                if (!userData.disc || !userData.refresh) continue;

                // Decrypt refresh token and use it to make the access token up to date and valid
                let refreshToken = decrypt(userData.refresh);
                let accessToken = await refreshAccessToken(refreshToken, userData.disc);
                if (!accessToken) continue;

                // Update the submission to be accepted in the database
                await executeMysqlQuery(`UPDATE submissions SET outcome = ? WHERE id = ?`, ['accepted', submissionArray[i]]);

                // Add the roles the user should get in the discord server
                let roles = [];
                roles.push(process.env.PARTICIPANT_ROLE_ID);

                // Add the user to the discord server
                await putUserInGuild(accessToken, userData.disc, process.env.GUILD_ID, roles);
                // Wait a sec... *Sips tea*
                await sleep(1000);
            };

            // Return a message to the client
            return res.json({ success: true, message: `${submissionArray.length} submission${submissionArray.length > 1 ? `s have` : ` has`} been marked as accepted!\nSubmissions: ${submissionArray.join(", ")}` });
        });

        // For each request, mark it as denied and send a res back to the client
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

        // For each request, mark it as pending and send a res back to the client
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

        // Toggle a user's ban status, unban if banned, ban if not banned
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

            // Update the user's ban status
            // Return a message to the client
            if (userData[0].is_banned) {
                await executeMysqlQuery(`UPDATE users SET is_banned = ? WHERE disc = ?`, [0, discordData.id]);
                return res.json({ success: true, message: `Successfully unbanned ${discordName}` });
            } else {
                forceHome.push(req.body.userid);
                await executeMysqlQuery(`UPDATE users SET is_banned = ? WHERE disc = ?`, [1, discordData.id]);
                return res.json({ success: true, message: `Successfully banned ${discordName}` });
            }
        });

        // Endpoint to update a user's perms level and store in db
        this.router.post('/dev/updatePermissionLevel', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'dTs54Cskv38ga1') return res.json({ "error": "You are not allowed to use this endpoint" });

            let userData = await executeMysqlQuery(`SELECT * FROM users WHERE disc = ?`, [req.body.userid]);
            if (!userData.length) return res.json({ "error": "User not found" });

            if (req.body.userid === req.session.discordId) return res.json({ "error": "You cannot change your own permissions" });

            // fetch the user's profile for a nicety in the return message
            let discordData;
            let url = process.env.HOSTNAME + '/api/getProfileById/' + req.body.userid + '?isFromServer=c2f64dea9444&requestId=' + req.session.discordId;
            await fetch(url).then(res => res.json()).then((data) => discordData = data);

            let discordName = discordData.username ?? `Unknown` + '#' + discordData.discriminator ?? `0000`;

            // Set the perms and reply to the client
            await executeMysqlQuery(`UPDATE users SET perms = ? WHERE disc = ?`, [req.body.newPerms, discordData.id]);
            return res.json({ success: true, message: `Successfully updated ${discordName}'s permission level.\nWas: ${userData[0].perms} | Now: ${req.body.newPerms}` });
        });

        // Endpoint to create a new form
        this.router.post('/dev/createNewForm', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'joRP228zYm213g') return res.json({ "error": "You are not allowed to use this endpoint" });

            let formName = req.body.formName;
            let formDescription = req.body.formDescription;
            let formPerms = req.body.formPerms;
            let formShown = req.body.formShown;
            let formMaxResponses = req.body.formMaxResponses;

            // insert form metadata into db
            let nfData = await executeMysqlQuery(`INSERT INTO forms (name, \`desc\`, perms, is_hidden, max_responses) VALUES (?, ?, ?, ?, ?)`, [formName, formDescription, formPerms, formShown, formMaxResponses]);

            return res.json({ success: true, message: `A new form was successfully created.\nName: ${formName}\nID: ${nfData.insertId}` });
        });

        // Endpoint to create a new question for a form
        this.router.post('/dev/createNewQuestion', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'QAhjCCfzedT4Yh') return res.json({ "error": "You are not allowed to use this endpoint" });

            let formId = req.body.formId;
            let questionShort = req.body.questionShort;
            let questionType = req.body.questionType;
            let questionText = req.body.questionText;
            let questionData = req.body.questionData;

            // insert question metadata into db
            let nfData = await executeMysqlQuery(`INSERT INTO questions (form_id, question, short_id, type, data) VALUES (?, ?, ?, ?, ?)`, [formId, questionText, questionShort, questionType, questionData]);

            return res.json({ success: true, message: `A new question was successfully created.\nForm ID: ${formId}\nQuestion ID: ${nfData.insertId}` });
        });

        // Endpoint to get all forms
        this.router.get('/dev/getAllForms', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'ixwAW5LXGTjgG') return res.json({ "error": "You are not allowed to use this endpoint" });

            // fetch all forms
            let forms = await executeMysqlQuery(`SELECT * FROM forms`);
            return res.json(forms);
        });

        // Endpoint to get all questions for a form
        this.router.post('/dev/toggleFormVis', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'ixVu6veCBqpasc42') return res.json({ "error": "You are not allowed to use this endpoint" });

            let formData = await executeMysqlQuery(`SELECT * FROM forms WHERE id = ?`, [req.body.formid]);
            if (!formData.length) return res.json({ "error": "Form not found" });

            // toggle the form's visibility, and return a message to the client
            if (formData[0].is_hidden) {
                await executeMysqlQuery(`UPDATE forms SET is_hidden = ? WHERE id = ?`, [0, req.body.formid]);
                return res.json({ success: true, message: `Successfully marked ${formData[0].name} as shown!` });
            } else {
                forceHome.push(req.body.userid);
                await executeMysqlQuery(`UPDATE forms SET is_hidden = ? WHERE id = ?`, [1, req.body.formid]);
                return res.json({ success: true, message: `Successfully marked ${formData[0].name} as hidden!` });
            }
        });

        // Endpoint to get a user's data from the API
        this.router.get('/getProfileById/:discordId', async (req, res) => {
            if (!req.session.discordId && !req.query.requestId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'c2f64dea9444') return res.json({ "error": "You are not allowed to use this endpoint" });

            // Make request to discord, use bot token because the user is probably in a server with the bot already
            const response = await fetch(`https://discord.com/api/v10/users/${req.params.discordId}`, {
                headers: {
                    Authorization: `Bot ${process.env.BOT_TOKEN}`
                }
            });

            // If the user is not found, return an error
            if (response.status !== 200) return res.json({ "error": "User not found" });
            // Otherwise, return the user's data
            return res.json(await response.json());
        });

        // Endpoint to get a user's data from the API
        this.router.get('/admin/getUOByID/:userId', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.query.isFromServer;
            if (isFromServer != 'Fg5fBuPV') return res.json({ "error": "You are not allowed to use this endpoint" });

            // Get the user data by their user Id
            let userData = await executeMysqlQuery(`SELECT * FROM users WHERE id = ?`, [req.params.userId]);
            if (!userData.length) return res.json({ "error": "User not found" });

            return res.json(userData[0]);
        });

        // Set a user's minecraft name
        this.router.post('/user/setminecraft', async (req, res) => {
            if (!req.session.discordId) return res.json({ "error": "You are not logged in" });

            let isFromServer = req.body.SWAZg59PN7oS3;
            if (!isFromServer) return res.json({ "error": "You are not allowed to use this endpoint" });

            // Get the minecraft name from the request body
            let minecraftName = req.body.mcName;
            if (!minecraftName) return res.json({ "error": "You did not provide a Minecraft name" });

            // Set the user's minecraft name in the database
            await executeMysqlQuery(`UPDATE users SET mc = ? WHERE disc = ?`, [minecraftName, req.session.discordId]);
            // Set the user's minecraft name in the session
            req.session.mcName = minecraftName;
            // Return a success message
            return res.json({ success: true, message: `Your Minecraft name was successfully updated to ${minecraftName}` });
        });

        // The endpoint wasn't found, return an error
        this.router.use((req, res) => {
            res.status(404).json({
                "error": "This API endpoint is invalid or has moved."
            });
        });

        // Return the router so that it gets added to the main app
        return this.router
    }
}

// Export the API class so it can be read by the registerRoutes function in app.js
module.exports = API;