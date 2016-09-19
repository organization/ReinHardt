var ReinHardt = require('./index.js');
var ddnsServer = require('./ddns-server.js');
var path = require('path');
var checkip = require('check-ip-address');

var hostname = process.argv[2] || 'localhost';
var port = process.argv[3] || 80;

var logger = (log) => ReinHardt.requestLog(log);

class ReinHardtServer {
    static load() {
        logger('LOAD THE DDNS REINHARDT DDNS SERVER...');
        logger(`CREATE CHECK 'pubkey.pem' 'privkey.pem'`);

        let loader = () => {
            let reinHardtData = ReinHardt.getReinHardtData();

            //CREATE DDNS SERVER
            ddnsServer.create({
                dnsPort: 53,
                httpPort: 80,
                filepath: path.join(process.cwd(), '.ddnsd.sqlite3'), //DDNS DB
                primaryNameserver: `${reinHardtData['domain']}`,
                nameservers: [{
                    name: `${reinHardtData['domain']}`,
                    ipv4: hostname
                }]
            }).listen().then(() => {
                logger('DDNS REINHARDT DDNS SERVER LOADED.');
                var externalIpFindService = 'https://api.ipify.org';
                return checkip.getExternalIp(externalIpFindService).then(function(ip) {
                    logger(`DDNS SERVER EXTERNAL IP: '${ip}:${port}'`);
                });
            });
        };

        ReinHardt.createPem(() => {
            ReinHardt.checkDomain(loader);
        });
    }
}

//ReinHardt.registerDNSRecord(reinHardtData['domain'],
//    'server-1', '111.111.111.111', 1, 1);
//ReinHardt.registerDNSRecord(reinHardtData['domain'],
//    'server-2', '100.100.100.100', 1, 2);

//ReinHardt.load();
//ReinHardt.addAddressForward('mc.pe.kr', '175.116.100.162', '222.222.222.222');
module.exports = ReinHardtServer;
