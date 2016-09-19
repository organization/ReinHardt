'use strict';

module.exports.create = function(opts) {
    var PromiseA = require('bluebird');
    var DnsStore = opts.store;

    function getZone(DnsStore, zones, zonesMap) {
        var promise = PromiseA.resolve();

        zones.forEach(function(zone) {
            promise = promise.then(function() {

                // TODO this won't perform well with thousands of records (but that's not a problem yet)
                // maybe store a list of big zones with subzones in memory?
                // (and assume a single device won't more than 100 of them - which would be 100,000 domains)
                return DnsStore.Domains.find({
                    zone: zone
                }).then(function(rows) {
                    rows.forEach(function(row) {
                        if (!row.name) {
                            row.name = row.zone;
                        }
                    });

                    zonesMap[zone] = rows;
                    //zones.push(rows);
                });
            });
        });

        return promise;
    }

    function getAnswerList(questions, cb) {
        // cb is of type function (err, answers) { }
        // answers is an array of type { name: string, type: string, priority: int, ttl: int, answer: string }
        var promise = PromiseA.resolve();
        var records = [];

        // determine the zone and then grab all records in the zone
        // 'music.cloud.jake.smithfamily.com'.split('.').slice(-2).join('.')
        // smithfamily.com // this is the zone (sorry jake, no zone for you)
        questions.forEach(function(q) {
            promise = promise.then(function() {
                // TODO how to get zone fast and then get records?
                // NOTE: LetsEncrypt does this: WwW.EXAmpLe.coM
                // and then they expect it to come back in the same weird way for security
                var parts = q.name.toLowerCase().split('.').filter(function(n) {
                    return n;
                });
                var zone;
                var zoneRecords = [];
                var zonesMap = {};
                var zones = [];

                // look for all possible matching zones
                // cloud.aj.daplie.me
                // aj.daplie.me
                // daplie.me
                // TODO the case of aj.daplie.me + aj@daplie.me
                // TODO use tld, private tld, and public suffix lists instead
                while (parts.length >= 2) {
                    zone = parts.join('.');
                    parts.shift();
                    if (!zonesMap[zone]) {
                        zonesMap[zone] = true;
                        zones.push(zone);
                    }
                }

                // TODO handle recursive ANAME (and CNAME?) lookup
                return getZone(DnsStore, zones, zonesMap).then(function(recs) {
                    if (recs && recs.length) {
                        return recs;
                    }

                    Object.keys(zonesMap).forEach(function(key) {
                        zonesMap[key].forEach(function(record) {
                            records.push(record);
                            zoneRecords.push(record);
                        });
                    });

                    return zoneRecords;
                });
            });
        });

        return promise.then(function() {
            return records;
        }).then(function(ans) {
            cb(null, ans);
        }, function(err) {
            cb(err);
        });
    }

    return {
        getAnswerList: getAnswerList
    };
};
