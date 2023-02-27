const { makeConnection, executeMysqlQuery, endConnection } = require('../utilities/mysqlHelper');

beforeAll(() => {
    // before tests, establish a connection to the database
    return makeConnection();
});

afterAll(() => {
    // after tests, close the connection to the database
    return endConnection();
});

test('Test MySQL query', async () => {
    // drop table if exists
    await executeMysqlQuery('DROP TABLE IF EXISTS test');
    // create a test table
    await executeMysqlQuery('CREATE TABLE test (id INT, name VARCHAR(255))');
    // insert a row
    await executeMysqlQuery('INSERT INTO test (id, name) VALUES (1, "test")');
    // select the row
    const result = await executeMysqlQuery('SELECT * FROM test');
    // check the result
    expect(result).toEqual([{ id: 1, name: 'test' }]);
    // clean up test table
    await executeMysqlQuery('DROP TABLE IF EXISTS test');
});
