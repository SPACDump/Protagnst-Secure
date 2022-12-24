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
const { checkUserPermissions } = require('../utilities/userFunctions');

// start mysql connection
makeConnection();

let accessLogStream = rfs.createStream('access.log', {
    interval: '1d', // rotate daily
    size: '20M', // rotate when file size exceeds 20 MegaBytes
    compress: "gzip", // compress rotated files
    path: path.join(__dirname, '../..', 'logs/access')
})

class App {
    io;
    server;
    constructor() {
        this.app = express();
        this.server = require('http').createServer(this.app);
        this.app.engine('e', require('ejs').renderFile);
        this.app.set('view engine', 'ejs');
        this.app.set('views', path.join(__dirname, '..', 'views'));
        this.app.use(cors());
        this.app.use(sessions({
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
        this.app.use('/public', express.static(path.join(__dirname, '..', 'public')));
    }

    async registerRoutes() {
        const filePath = path.join(__dirname, '..', 'routes');
        const files = await fsp.readdir(filePath);
        for await (const file of files) {
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

        this.app.use(function (req, res, next) {
            if (req.session.isBanned === true) {
                let allowedPages = ['/ban', '/logout', '/support', '/error', '/403', '/404', '/jswarning'];
                if (allowedPages.includes(req.path)) next();
                else res.redirect('/ban');
            } else {
                next();
            }
        });

        this.app.get('/auth', async function (req, res) {
            if (req.session.discordId) res.redirect('/');
            else res.render('auth.ejs');
        });
        
        this.app.get('/ban', async function (req, res) {
            if (!req.session.discordId) res.redirect('/');
            else res.render('userBanned.ejs');
        });

        this.app.get('/', async function (req, res) {
            let session = req.session;

            if (session.discordId) {
                let user = await executeMysqlQuery(`SELECT * FROM users WHERE discord_id = (?)`, [req.session.discordId]);
                if (user[0]) {
                    if (user[0].is_banned === 1) {
                        req.session.isBanned = true;
                        return res.redirect('/ban');
                    }
                }

                res.render('home.ejs', {
                    session: req.session
                });
            } else {
                res.redirect('/auth');
            }
        });

        this.app.get('/support', async function (req, res) {
            res.render('support.ejs');
        });

        this.app.get('/error/:errorCode', async function (req, res) {
            let errorCode = req.params.errorCode;
            let reason;
            switch (errorCode) {
                case "firstCode": { reason = "Example, default, first error code"; break; };
                default: { reason = "An unknown error ocurred"; break; };
            }
            res.render('dataError.ejs', { errorReason: reason })
        });

        this.app.get('/403', async function (req, res) {
            res.status(403).render('403.ejs');
        });

        this.app.get('/jswarning', async function (req, res) {
            if (req.session.discordId) return res.redirect('/');
            res.render('jswarning.ejs');
        });

        this.app.get('/new', async function (req, res) {
            if (!req.session.discordId) return res.redirect('/auth');
            else res.render('selectNewForm.ejs', { session: req.session });
        });

        this.app.get('/my', async function (req, res) {
            if (!req.session.discordId) return res.redirect('/auth');
            else res.render('selectAvailableSubmission.ejs', { session: req.session });
        });

        this.app.get('/view/:submissionId', async function (req, res) {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let submissionId = req.params.submissionId;
            let subData = await executeMysqlQuery(`SELECT * FROM submissions WHERE submission_id = ?`, [submissionId]);
            if (subData.length < 0) return res.redirect('/404');

            let userPerms = await checkUserPermissions(session.discordId);
            if (subData[0].discord_id != session.discordId && userPerms <= 2) return res.redirect('/403');

            let formData = await getFormById(subData[0].form_id);
            if (!formData) return res.redirect('/404');

            return res.render('viewSubmission.ejs', {
                session: req.session,
                submissionId: submissionId,
                formName: formData.form_name
            });
        });

        this.app.get('/fill/:formId', async (req, res) => {
            // check if user has already applied for this form
            let formId = req.params.formId;
            let session = req.session;
            let discordId = session.discordId;

            if (!discordId) return res.redirect('/auth');

            // check permissions
            // get form from mysql
            let form = await getFormById(formId);
            if (!form) return res.redirect('/404');

            let userPerms = await checkUserPermissions(discordId);

            if (userPerms < form.permissions_needed) {
                return res.redirect('/403');
            };

            res.render('fill.ejs', {
                formId: form.id,
                formName: form.form_name,
                session: req.session
            });
        });

        this.app.get('/admin', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission > 2) return res.render('admin.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        this.app.get('/admin/view', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission > 2) return res.render('adminView.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        this.app.get('/admin/export', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission > 2) return res.render('adminExport.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        this.app.get('/admin/export/:id', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission > 2) return res.render('adminExportDL.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        this.app.get('/admin/ban', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission > 2) return res.render('adminBan.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        this.app.get('/developer', async (req, res) => {
            let session = req.session;
            if (!session.discordId) return res.redirect('/auth');

            let userPermission = await checkUserPermissions(req.session.discordId);

            if (userPermission >= 50) return res.render('developer.ejs', { session: req.session });
            else return res.redirect('/403');
        });

            if (userPermission >= 50) return res.render('devCreateForm.ejs', { session: req.session });
            else return res.redirect('/403');
        });

        this.app.get('/transparency', async (req, res) => {
            res.render('transparency.ejs');
        });

        this.app.get('/transparency/deauth', async (req, res) => {
            res.render('deauth-guide.ejs');
        });

        this.app.get('/credits', async (req, res) => {
            res.render('credits.ejs');
        });

        this.app.use((req, res) => {
            res.render('404.ejs');
        });
    }

    async listen(fn) {
        this.server.listen(process.env.EXPRESS_PORT, fn)
    }
}

module.exports = App;