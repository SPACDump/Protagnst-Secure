const { executeMysqlQuery } = require("./mysqlHelper");

async function getAvailableForms() {
    let formsLength = await executeMysqlQuery(`SELECT * FROM forms`);
    return formsLength;

    // permissions: user, staff, site_admin
}

module.exports = { getAvailableForms };