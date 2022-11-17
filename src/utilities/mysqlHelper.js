const mysql = require('mysql');
const Logger = require('./consoleLog');
require('dotenv').config();

/**
 * MySQL connection
 * @constant {Object} connection new connection using the mysql library
 * @see https://github.com/mysqljs/mysql
 */
let connection;

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
            Logger.error('Error connecting to Db');
            return;
        }
        Logger.info('Connection established');
    });
}

async function executeMysqlQuery(query, params) {
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