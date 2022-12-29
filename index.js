console.clear();
const { validateLicenseKey } = require("./validateLicense.js");

(async function () {
    let startup = await validateLicenseKey();

    if (startup) {
        const Client = new (require("./src/classes/App.js"))
        const Logger = require('./src/utilities/consoleLog.js');

        await Client.registerRoutes();
        await Client.listen(() => {
            Logger.info(`Server listening on ${process.env.EXPRESS_IP}:${process.env.EXPRESS_PORT}`);
        }, true);
    }
})();

let forceHome = [];
module.exports = { forceHome };