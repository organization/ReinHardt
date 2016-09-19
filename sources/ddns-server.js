'use strict';

var PromiseA = require('bluebird');
var path = require('path');
var app = require('express')();
var RSA = PromiseA.promisifyAll(require('rsa-compat').RSA);
var ndns = require('native-dns');
var serveStatic = require('serve-static');
var jsonParser = require('body-parser').json;

var defaults = {
    dnsPort: 53,
    dnsTcpPort: 53,
    httpPort: 80,
    httpsPort: 443,
    filepath: path.join(require('os').homedir(), '.ddnsd.sqlite3'),
    prefix: '/api/com.daplie.ddns',
    primaryNameserver: 'ns1.example.com',
    nameservers: [{
        name: 'ns1.example.com',
        ipv4: '192.168.1.101'
    }]
};

module.exports.create = function(opts) {
    var privkeyPath = path.join(process.cwd(), 'privkey.pem');

    RSA.getKeypairAsync = function(filepath, bitlen, exp, options) {
        var PromiseA = require('bluebird');
        var fs = PromiseA.promisifyAll(require('fs'));

        return fs.readFileAsync(filepath, 'ascii').then(function(pem) {
            return RSA.import({
                privateKeyPem: pem
            }, options);
        }, function( /*err*/ ) {
            return RSA.generateKeypairAsync(bitlen, exp, options, function(err, keypair) {
                return fs.writeFileAsync(filepath, keypair.privateKeyPem, 'ascii').then(function() {
                    return keypair;
                });
            });
        });
    };

    var bitlen = 2048;
    var exp = 65537;
    var options = {
        public: true,
        pem: true,
        internal: true
    };
    var port = opts.dnsPort;
    var address4 = '0.0.0.0';

    return {
        listen: function() {
            var checkip = require('check-ip-address');
            var service = 'https://api.ipify.org'; // default
            //var service = 'https://coolaj86.com/services/whatsmyip'; // another option
            return checkip.getExternalIp(service).then(function(ip) {
                if (!ip) {
                    console.warn('');
                    console.warn('');
                    console.warn(require('os').networkInterfaces());
                    console.warn('');
                    throw new Error('no public ip address is available to listen on');
                }
                defaults.nameservers[0].name = opts.primaryNameserver;
                defaults.nameservers[0].ipv4 = ip;

                return RSA.getKeypairAsync(privkeyPath, bitlen, exp, options).then(function(keypair) {
                    require('./ddns-rest-store.js').create({
                        filepath: opts.filepath
                    }).then(function(store) {

                        app.use('/api', jsonParser());

                        require('./ddns-rest.js').create({
                            keypair: {
                                publicKeyPem: RSA.exportPublicPem(keypair)
                            },
                            store: store,
                            prefix: opts.prefix,
                            app: app
                        });

                        app.use('/', serveStatic(require('ddns-webapp').path));

                        var ReinHardt = require('./reinhardt.js');
                        var plainPort = opts.httpPort;
                        require('http').createServer(app).listen(plainPort, function() {
                            ReinHardt.requestLog(`Daplie DDNS RESTful API listening on port ${plainPort}`);
                        });

                        var getAnswerList = require('./ddns-nameserver-query.js').create({
                            store: store
                        }).getAnswerList;

                        var ns = require('./ddns-nameserver.js').create({
                            store: store,
                            primaryNameserver: opts.primaryNameserver,
                            nameservers: opts.nameservers,
                            getAnswerList: getAnswerList
                        });

                        var udpDns = ndns.createServer();
                        var tcpDns = ndns.createTCPServer();

                        udpDns.on('error', ns.onError);
                        udpDns.on('socketError', ns.onSocketError);
                        udpDns.on('request', ns.onRequest);
                        udpDns.on('listening', function() {
                            ReinHardt.requestLog(`DNS Server running on udp port ${port}`);
                        });
                        udpDns.serve(port, address4);

                        tcpDns.on('error', ns.onError);
                        tcpDns.on('socketError', ns.onSocketError);
                        tcpDns.on('request', ns.onRequest);
                        tcpDns.on('listening', function() {
                            ReinHardt.requestLog(`DNS Server running on tcp port ${port}`);
                        });
                        tcpDns.serve(port, address4);
                    });
                });
            });
        }
    };
};

if (require.main === module) {
    module.exports.create(defaults).listen();
}
