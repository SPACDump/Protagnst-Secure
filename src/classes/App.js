// Import all required modules
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const rfs = require('rotating-file-stream');
const logger = require('morgan');
const Router = require('./Router');
const Logger = require('../utilities/consoleLog');
const sessions = require('express-session');
require('dotenv').config();
const { makeConnection, executeMysqlQuery } = require('../utilities/mysqlHelper');
const { getFormById } = require('../utilities/formFunctions');
const { checkUserPermissions, getUserBanStatus } = require('../utilities/userFunctions');
const { forceHome } = require('../..');

// start mysql connection
makeConnection();

let accessLogStream = rfs.createStream('access.log', {
    interval: '1d', // rotate daily
    size: '20M', // rotate when file size exceeds 20 MegaBytes
    compress: "gzip", // compress rotated files
    path: path.join(__dirname, '../..', 'logs/access')
});

// Make a class for the app
// and use the Router class as a base

// This class will be used to create the app
// and register all routes
class App {
    io;
    server;
    constructor() {
        // Create the app and the server
        this.app = express();
        this.server = require('http').createServer(this.app);
        // Create ejs and use it as a render engine
        this.app.engine('e', require('ejs').renderFile);
        this.app.set('view engine', 'ejs');
        // Set the views directory
        this.app.set('views', path.join(__dirname, '..', 'views'));
        // Setup cors, sessions, cookies, logger, json and urlencoded
        this.app.use(cors());
        this.app.use(sessions({
            // This is a secret key, it is used to encrypt the session cookie
            secret: "secure-protagnst-wMYwBT6rcRwEQ8NgJkSLZsJ2d7xgyAhSfja2DJoWow9uRP7qEtT6PurqUo9N",
            saveUninitialized: true,
            cookie: { maxAge: 1000 * 60 * 60 * 24 },
            resave: false
        }));
        this.app.use(cookieParser());
        this.app.use(logger('[:date[iso]] :remote-addr ":referrer" ":user-agent" :method :url :status :res[content-length] - :response-time ms', { stream: accessLogStream }));
        this.app.use(logger(' >> :method :url :status :res[content-length] - :response-time ms'));
        this.app.use(express.json());
        this.app.use(express.urlencoded({
            extended: true
        }));
        // Register assets as a route from the public folder
        this.app.use('/public', express.static(path.join(__dirname, '..', 'public')));
    }

    // This function will be used to start the app
    // And look for other router class instances like /api
    async registerRoutes() {
        const filePath = path.join(__dirname, '..', 'routes');
        const files = await fsp.readdir(filePath);
        for await (const file of files) {
            // Make sure the file is a Router instance
            if (file.endsWith('.js')) {
                const router = require(path.join(filePath, file));
                if (router.prototype instanceof Router) {
                    const instance = new router(this);
                    Logger.route(`Route ${instance.path} serving.`);
                    if (instance.auth) {
                        this.app.use(instance.path, this.Authentication, instance.createRoute());
                    } else {
                        this.app.use(instance.path, instance.createRoute());
                    }
                }
            }
        }

        // Middleware:
        // This middleware will check 3 things:
        // 1. If the user needs to be redirected to the home page
        // 2. If the user is banned
        // 3. If the endpoint should be logged to the database requests table
        this.app.use(async function (req, res, next) {
            if (forceHome.includes(req.session.discordId)) {
                forceHome.splice(forceHome.indexOf(req.session.discordId), 1);
                return res.redirect('/');
            };

            if (req.session.isBanned === true) {
                let allowedPages = ['/ban', '/logout', '/support', '/error', '/403', '/404', '/jswarning'];
                if (allowedPages.includes(req.path)) return next();
                else return res.redirect('/ban');
            };

            let dontLogTheseEndpoints = ["/favicon.ico"];
            if (!req.session || !req.session.userId) return next();
            if (req.session.userId && !dontLogTheseEndpoints.includes(req.path)) await executeMysqlQuery(`INSERT INTO requests (user_id, page, time) VALUES (?, ?, ?)`, [req.session.userId, req.path, Math.floor(Date.now()/1000)]);
            return next();
        });

        // Main login page
        this.app.get('/auth', async function (req, res) {
            // Happens on most/all pages, if the user is logged in, redirect to the appropriate page
            if (req.session.discordId) return res.redirect('/');
            // In this case, if they are not logged in - they need to see the login page.
            return res.render('auth.ejs');
        });
        
        // The ban page
        this.app.get('/ban', async function (req, res) {
            // If the user isn't signed in or isn't banned, redirect to the home page
            if (!req.session.discordId || !req.session.isBanned) return res.redirect('/');
            // If they are banned, show them the ban page
            return res.render('userBanned.ejs');
        });

        // The home page
        this.app.get('/', async function (req, res) {
            let session = req.session;

            // If the user isn't logged in, redirect to the login page
            if (!session.discordId) return res.redirect('/auth');
            let banStatus = await getUserBanStatus(session.discordId);

            // If the user is banned, redirect to the ban page
            if (banStatus) {
                session.isBanned = true;
                return res.redirect('/ban');
            }

            // If the user hasn't set their minecraft name, redirect to the settings page
            if (!session.mcName || session.mcName === null) return res.redirect('/settings/mc');

            // Render the home page
            return res.render('home.ejs', { session: session });
        });

        // The support page
        this.app.get('/support', async function (req, res) {
            return res.render('support.ejs');
        });

        // Error handling (Not used as much in recent updates)
        this.app.get('/error/:errorCode', async function (req, res) {
            let errorCode = req.params.errorCode;
            let reason;

            switch (errorCode) {
                case "deprecated": { reason = "This page isn't really used anymore."; break; };
                default: { reason = "An unknown error occurred."; break; };
            }

            // Render error page and send the reason to the client
            return res.render('dataError.ejs', { errorReason: reason })
        });

        // 403 page
        this.app.get('/403', async function (req, res) {
            return res.status(403).render('403.ejs');
        });

        // no javascript warning page
        this.app.get('/jswarning', async function (req, res) {
            // if they are logged in, it means they have javascript enabled
            if (req.session.discordId) return res.redirect('/');

            // if they are not logged in, show them the warning page
            // - they were probably redirected here from the login page
            return res.render('jswarning.ejs');
        });

        // Select new submission form to fill out page
        this.app.get('/new', async function (req, res) {
            // Like all other pages from here on out:
            // If the user isn't logged in, redirect to the login page
            if (!req.session.discordId) return res.redirect('/auth');
            // and, if they are logged in, show them the page
            return res.render('selectNewForm.ejs', { session: req.session });
        });

        // View my submissions page
        this.app.get('/my', async function (req, res) {
            if (!req.session.discordId) return res.redirect('/auth');
            return res.render('selectAvailableSubmission.ejs', { session: req.session });
        });

        // User settings page
        this.app.get('/settings', async function (req, res) {
            if (!req.session.discordId) return res.redirect('/auth');

            // Aggregate query to get total member count
            let totalMemberCount = await executeMysqlQuery(`SELECT COUNT(*) AS total FROM users`);
            // If there is no data, set the count to 0 as a fallback
            if (totalMemberCount.length <= 0) totalMemberCount = 0;
            // If there is data, set the count to the total that was returned
            else totalMemberCount = totalMemberCount[0].total;

            // format number with commas
            totalMemberCount = totalMemberCount.toLocaleString();
            
            return res.render('userSettings.ejs', { session: req.session, totalMemberCount: totalMemberCount });
        });

        // User settings page - minecraft name
        this.app.get('/settings/mc', async function (req, res) {
            if (!req.session.discordId) return res.redirect('/auth');
            return res.render('userSetMinecraft.ejs', { session: req.session });
        });

        // view submission page
        this.app.get('/view/:submissionId', async function (req, res) {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            // Get the submission data
            let submissionId = req.params.submissionId;
            let subData = await executeMysqlQuery(`SELECT * FROM submissions WHERE id = ?`, [submissionId]);
            if (subData.length <= 0) return res.redirect('/404');

            // Check user permissions
            let userPerms = await checkUserPermissions(session.discordId);
            // If user doesn't own submission or isn't staff or higher, redirect to 403
            if (subData[0].user_id != session.userId && userPerms <= 2) return res.redirect('/403');

            // Get the questions for the form
            let formData = await getFormById(subData[0].form_id);
            if (!formData) return res.redirect('/404');

            // Send them to client so they can be coupled with the answers and dispalyed as a read-only copy
            return res.render('viewSubmission.ejs', {
                session: req.session,
                submissionId: submissionId,
                formName: formData.name
            });
        });

        // Staff stats page
        this.app.get('/stats', async function (req, res) {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            // Like all pages similar to this:
            // If the user isn't staff or higher, redirect to 403
            let userPerms = await checkUserPermissions(session.discordId);
            if (userPerms <= 2) return res.redirect('/403');

            // Render the page
            return res.render('formStatsAll.ejs', { session: req.session });
        });

        // Staff stats page - select specific form
        this.app.get('/stats/select', async function (req, res) {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPerms = await checkUserPermissions(session.discordId);
            if (userPerms <= 2) return res.redirect('/403');

            return res.render('formStatsSelect.ejs', {
                session: req.session
            });
        });

        // Staff stats page - view specific form
        this.app.get('/stats/:formId', async function (req, res) {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            // Get the form data
            let formId = req.params.formId;
            let formData = await getFormById(formId);
            if (!formData) return res.redirect('/404');

            let userPerms = await checkUserPermissions(session.discordId);
            if (userPerms <= 2) return res.redirect('/403');

            // Render page with form data on client
            return res.render('formStats.ejs', {
                session: req.session,
                formId: formId,
                data: formData
            });
        });

        // Staff stats - view requests graph
        // A graph to show all requests made at times over the past 24 hours
        // So that my client can see when the most requests are made (when the system is the busiest)
        this.app.get('/graphs', async function (req, res) {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPerms = await checkUserPermissions(session.discordId);  
            if (userPerms <= 2) return res.redirect('/403');

            return res.render('graphView.ejs', { session: req.session });
        });

        this.app.get('/fill/:formId', async (req, res) => {
            // check if user has already applied for this form
            let formId = req.params.formId;
            let session = req.session;
            let discordId = session.discordId;

            // Same check as above in different format
            // Redirect to login page if user isn't logged in
            if (!discordId) return res.redirect('/auth');

            // get form data
            let form = await getFormById(formId);
            if (!form) return res.redirect('/404');

            // Check user permissions
            let userPerms = await checkUserPermissions(discordId);

            // If user isn't high enough to fill out form, redirect to 403
            if (userPerms < form.permissions_needed) return res.redirect('/403');

            return res.render('fill.ejs', {
                formId: form.id,
                formName: form.name,
                session: req.session
            });
        });

        // Admin home page
        this.app.get('/admin', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            // Like all staff pages:
            // If user isn't staff or higher, redirect to 403
            // Else render the page
            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission > 2) return res.render('admin.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        // Admin view open submissions page
        this.app.get('/admin/view', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission > 2) return res.render('adminView.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        // Export data to spreadsheet - admin page - select form
        this.app.get('/admin/export', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission > 2) return res.render('adminExport.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        // Export data to spreadsheet - admin page - select form - download
        this.app.get('/admin/export/:id', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission > 2) return res.render('adminExportDL.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        // Admin ban user page
        this.app.get('/admin/ban', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission > 2) return res.render('adminBan.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        // Admin update submissions in bulk page
        this.app.get('/admin/update', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission > 2) return res.render('adminBulkUpdate.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        // Developer (high staff) home page
        this.app.get('/developer', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission >= 50) return res.render('developer.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        // Developer update user permissions page
        this.app.get('/developer/perm', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission >= 50) return res.render('devUpdatePerms.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        // Developer create form page
        this.app.get('/developer/form', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission >= 50) return res.render('devCreateForm.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        // Developer create question page
        this.app.get('/developer/question', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission >= 50) return res.render('devCreateQuestion.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        // Developer change form visibility page
        this.app.get('/developer/vis', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission >= 50) return res.render('devChangeFormVis.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        // Public data transparency guide
        this.app.get('/transparency', async (req, res) => {
            return res.render('transparency.ejs');
        });

        // Public data transparency guide - deauthorization of Discord account
        this.app.get('/transparency/deauth', async (req, res) => {
            return res.render('deauth-guide.ejs');
        });

        // Public guide - credits page
        this.app.get('/credits', async (req, res) => {
            return res.render('credits.ejs');
        });

        // If no page is found, render 404
        this.app.use((req, res) => {
            return res.render('404.ejs');
        });
    }

    // Listen on the environment's port and IP for requests
    // This now serves as the main entry point for the application
    async listen(fn) {
        this.server.listen(process.env.EXPRESS_PORT, process.env.EXPRESS_IP, fn)
    }
}

module.exports = App;