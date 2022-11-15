const { executeMysqlQuery } = require("./mysqlHelper");

async function getAvailableForms() {
    // @TODO Pass in user permissions to filter out forms they can't access
    let formsLength = await executeMysqlQuery(`SELECT * FROM forms`);
    return formsLength;

    // permissions: user, staff, site_admin
}

module.exports = { getAvailableForms };