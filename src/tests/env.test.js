require('dotenv').config();

test('check environment variables are set', () => {
    expect(process.env.MYSQL_HOST).toBeDefined();
    expect(process.env.MYSQL_DATABASE).toBeDefined();
    expect(process.env.MYSQL_USERNAME).toBeDefined();
    expect(process.env.MYSQL_PASSWORD).toBeDefined();
    expect(process.env.MYSQL_PORT).toBeDefined();
    expect(process.env.ENC_KEY).toBeDefined();
    expect(process.env.ENC_IV).toBeDefined();
    expect(process.env.EXPRESS_PORT).toBeDefined();
    expect(process.env.NODE_ENV).toBeDefined();
});

test('check for valid ports', () => {
    // convert to number
    const mysqlPort = parseInt(process.env.MYSQL_PORT);
    const expressPort = parseInt(process.env.EXPRESS_PORT);
    // check if the ports are valid
    expect(mysqlPort).toBeGreaterThan(0);
    expect(mysqlPort).toBeLessThan(65536);
    expect(expressPort).toBeGreaterThan(0);
    expect(expressPort).toBeLessThan(65536);
});

test('check for valid encryption key and iv', () => {
    // expect to be 16,24,32 bytes long
    const lengths = [16, 24, 32];
    expect(lengths).toContain(process.env.ENC_KEY.length);
    expect(lengths).toContain(process.env.ENC_IV.length);
});
