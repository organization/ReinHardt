var http = require('http');
var fs = require('fs');
var path = require('path');
var readline = require('readline');
var PromiseA = require('bluebird');
var jwt = require('jsonwebtoken');
var rsa = require('rsa-compat').RSA;
var ddnsServer = require('./ddns-server.js');
var fsPromise = PromiseA.promisifyAll(fs);

var hostname = process.argv[2] || 'localhost';
var port = process.argv[3] || 80;

var reinHardtData;
var addressForward = {};

/**
 * @param {string} log
 */
let logger = (log) => {
    let now = new Date();
    let timeFormat = String();
    timeFormat += (String(now.getHours()).length > 1 ? now.getHours() : '0' + now.getHours());
    timeFormat += ':' + (String(now.getMinutes()).length > 1 ? now.getMinutes() : '0' + now.getMinutes());
    timeFormat += ':' + (String(now.getSeconds()).length > 1 ? now.getSeconds() : '0' + now.getSeconds()) + "";
    let defaultFormat = String.fromCharCode(0x1b) + "[31;1m" + "[%time%] " + String.fromCharCode(0x1b) + "[37;1m" + "%log%";
    console.log(defaultFormat.replace('%time%', timeFormat).replace('%log%', log));
}

/**
 * @description
 * Simple and Powerful Round Robin DNS LoadBalancer.
 */
class ReinHardt {
    /**
     * @description
     * Create 'privkey.pem' and 'pubkey.pem'
     */
    static createPem(callback) {
        let bitlen = 2048;
        let exp = 65537;
        let opts = {
            public: true,
            pem: true
        };
        let cwd = process.cwd();
        let privkeyPath = path.join(cwd, 'privkey.pem');
        //let modulePrivkeyPath = path.join(cwd, 'node_modules/ddns-server/privkey.pem');
        let pubkeyPath = path.join(cwd, 'pubkey.pem');

        if (fs.existsSync(privkeyPath)) {
            logger(`PEM DATA ALREADY EXIST.`);
            callback();
            return false;
        }

        rsa.generateKeypair(bitlen, exp, opts, function(err, keypair) {
            console.info('');
            console.info('');
            fs.writeFileSync(privkeyPath, keypair.privateKeyPem, 'ascii');
            //fs.writeFileSync(modulePrivkeyPath, keypair.privateKeyPem, 'ascii');
            //^It might be origin module has problem, it will be need to modify.

            logger(`${privkeyPath}:`);
            console.info('');
            console.info(keypair.privateKeyPem);
            logger(keypair.privateKeyPem);

            console.info('');

            fs.writeFileSync(pubkeyPath, keypair.publicKeyPem, 'ascii');
            logger(`${pubkeyPath}:`);
            console.info('');
            logger(keypair.publicKeyPem);

            logger('CREATED PRIVACY-ENHANCED ELECTRONIC MAIL DATA.');
        });

        callback();
        return true;
    }

    static checkDomain(callback) {
        let reinHardtDataPath = path.join(process.cwd(), 'reinHardtData.json');
        if (fs.existsSync(reinHardtDataPath)) {
            reinHardtData = require(reinHardtDataPath);
            logger(`TARGET DOMAIN: ${reinHardtData['domain']}`);
            callback();
            return;
        }

        logger('PLEASE TYPE THE DOMAIN NAME: ');
        let line = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        line.on('line', function(input) {
            if (input == null) return;

            reinHardtData = {
                domain: input
            };
            fs.writeFileSync(reinHardtDataPath, JSON.stringify(reinHardtData), 'utf-8');
            logger(`TARGET DOMAIN: ${input}`);
            line.close();
            callback();
        });
    }

    /**
     * @return {object}
     */
    static getReinHardtData(){
        return reinHardtData;
    }

    /**
     * @description
     * Create Jwt token
     *
     * @param {string} domainName
     * @param {string} deviceName
     */
    static createJwt(domainName, deviceName) {
        // jwts/domainName/deviceName
        let jwtFolderPath = path.join(process.cwd(), 'jwts');
        try {
            if (!fs.existsSync(jwtFolderPath)) fs.mkdirSync(jwtFolderPath);
        } catch (e) {}

        let domainFolderPath = path.join(jwtFolderPath, domainName);
        try {
            if (!fs.existsSync(domainFolderPath)) fs.mkdirSync(domainFolderPath);
        } catch (e) {}

        let deviceJwtFilePath = path.join(domainFolderPath, `${deviceName}.jwt`);

        //privkey.pem domainName > deviceName
        let privkeyPath = path.join(process.cwd(), 'privkey.pem');
        let pem = fsPromise.readFileSync(privkeyPath, 'ascii');
        let tok = jwt.sign({
            cn: domainName,
            device: deviceName
        }, pem, {
            algorithm: 'RS256'
        });
        fs.writeFileSync(deviceJwtFilePath, tok, 'utf-8');

        logger(`CREATED JWT FILE. '${deviceName}.jwt'`);
        logger(`decode: ${JSON.stringify(jwt.decode(tok))}`);
        logger(tok);
    }

    /**
     * @param {string} domainName
     * @param {string} deviceName
     */
    static getJwtData(domainName, deviceName) {
        let deviceJwtFilePath = path.join(process.cwd(), `jwts/${domainName}/${deviceName}.jwt`);
        if (!fs.existsSync(deviceJwtFilePath)) ReinHardt.createJwt(domainName, deviceName);
        return fs.readFileSync(deviceJwtFilePath, 'utf-8');
    }

    /**
     * @param {string} serverIp
     * @param {string} serverPort
     * @param {string} domainName
     * @param {string} deviceName
     * @param {string} deviceIp
     * @param {number} ttl
     */
    static registerDNSRecord(serverIp, serverPort, domainName, deviceName, deviceIp, ttl) {
        let jwtData = String(ReinHardt.getJwtData(domainName, deviceName));

        let options = {
            host: serverIp,
            port: serverPort,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwtData}`,
                'Content-Type': 'application/json; charset=UTF-8'
            },
            path: '/api/com.daplie.ddns/dns'
        };

        options.agent = new http.Agent(options);

        let data = {
            registered: true,
            groupIdx: 1,
            type: "A",
            name: domainName,
            device: deviceName,
            value: deviceIp,
            ttl: ttl,
            token: jwtData
        }

        http.request(options, function(res) {
            res.pipe(process.stdout);
            res.on('end', () => {
                console.log();
                logger(`${domainName} DNS ADDED DEVICE:'${deviceName}' IP:'${deviceIp}'`);
            });
        }).on('error', (error) => {
            logger('REGISTER DNS RECORD FAILED!');
            logger(error);
        }).end(JSON.stringify([data]));
    }

    /**
     * @param {string} deviceName
     * @param {string} deviceIp
     */
    static updateDeviceIp(deviceName, deviceIp) {
        // TODO
    }

    /**
     * @param {string} deviceName
     */
    static deleteDeviceRecod(deviceName) {
        // TODO
    }

    /**
     * @param {string} domain
     * @param {string} clientIp
     * @param {string} serverIp
     */
    static addAddressForward(domain, clientIp, serverIp) {
        if (typeof(addressForward[domain]) == 'undefined' ||
            typeof(addressForward[domain]) == 'null')
            addressForward[domain] = {};
        addressForward[domain][clientIp] = serverIp;
    }

    /**
     * @param {string} domain
     * @param {string} clientIp
     */
    static removeAddressForward(domain, clientIp) {
        if (typeof(addressForward[domain]) == 'undefined' ||
            typeof(addressForward[domain]) == 'null') return;
        if (typeof(addressForward[domain][clientIp]) != 'undefined')
            delete(addressForward[domain][clientIp]);
        if (addressForward[domain].length == 0)
            delete(addressForward[domain]);
    }

    /**
     * @param {string} domain
     * @param {string} clientIp
     * @return {null} || {string}
     */
    static getAddressForward(domain, clientIp) {
        if (typeof(addressForward[domain]) == 'undefined' ||
            typeof(addressForward[domain]) == 'null') return null;
        return (typeof(addressForward[domain][clientIp]) != 'undefined') ?
            addressForward[domain][clientIp] : null;
    }

    static requestLog(log) {
        logger(log);
    }
}

module.exports = ReinHardt;
