const mysql = require('mysql');
const Logger = require('./consoleLog');
require('dotenv').config();

/**
 * MySQL connection
 * @constant {Object} connection new connection using the mysql library
 * @see https://github.com/mysqljs/mysql
 */
let connection;

// Connect to my sql database
async function makeConnection() {
    connection = mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        user: process.env.MYSQL_USERNAME || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'protagnstsecure',
        port: process.env.MYSQL_PORT || 3306
    });
    connection.connect(function (err) {
        if (err) {
            Logger.error(`App not able to connect to MySQL database. ${err}`);
            return process.exit(1);
        }
        Logger.mysql('Connection established');
    });
}

// Execute a query on the mysql database
async function executeMysqlQuery(query, params) {
    // Promise and only resolve the promise when the query is complete
    return new Promise((resolve, reject) => {
        Logger.mysql(query, params);
        connection.query(query, params, (error, results, fields) => {
            if (error) {
                reject(error);
            }
            resolve(results);
        });
    });
}

// End the connection to the mysql database (used for testing)
async function endConnection() {
    return new Promise((resolve, reject) => {
        connection.end((error) => {
            if (error) {
                reject(error);
            }
            resolve();
        });
    });
}

module.exports = { makeConnection, executeMysqlQuery, endConnection };