'use strict';
var ReinHardt = require('./reinhardt.js');

module.exports.create = function(ndns, conf, store) {
    var PromiseA = require('bluebird');

    if (!conf || !conf.primaryNameserver) {
        throw new Error("You must supply options, at least { primaryNamserver: 'ns1.example.com' }");
    }

    if (!conf.nameservers.length) {
        throw new Error("You must supply options with nameservers [{ ... }]");
    }

    conf.nameservers.forEach(function(ns) {
        if (!ns.name || !ns.ipv4) {
            console.error('nameserver object:', ns);
            throw new Error("You must supply options with nameservers { name: 'ns1.example.com', ipv4: '127.0.0.1' }");
        }
    });

    function setLocalhost(request, response, value) {
        var type = ndns.consts.QTYPE_TO_NAME[request.question[0].type];
        var name = request.question[0].name;
        var priority = 10;
        response.answer.push(
            ndns[type]({
                name: name,
                address: value,
                ttl: 43200 // 12 hours
                    ,
                data: [value],
                exchange: value,
                priority: priority || 10
            })
        );
    }

    function getSoa(conf, store, request) {
        // TODO needs fixin'
        var domainParts = request.question[0].name.split('.');
        while (domainParts.length > 2) {
            domainParts.shift();
        }
        var name = domainParts.join('.');
        var soa = {
            "name": name,
            "ttl": "7200",
            "primary": conf.primaryNameserver,
            "admin": "hostmaster." + name,
            // YYYYmmddss
            // http://mxtoolbox.com/problem/dns/DNS-SOA-Serial-Number-Format
            "serial": "2015120800",
            "refresh": "10800",
            "retry": "3600",
            // 14 days
            // http://mxtoolbox.com/problem/dns/DNS-SOA-Expire-Value
            "expiration": "1209600",
            "minimum": "1800"
        };

        return soa;
    }

    function handleAll(ndns, conf, store, request, response, cb) {
        var qs;

        if (request) {
            qs = request.question.map(function(q) {
                // TODO give the bits is well (for convenience)
                return {
                    name: q.name,
                    type: ndns.consts.QTYPE_TO_NAME[q.type],
                    class: ndns.consts.QCLASS_TO_NAME[q.class]
                };
                // TODO promise?
            });
        }

        store.getAnswerList(qs, function(err, zone) {
            // TODO clarify a.address vs a.data vs a.values
            if (err) {
                throw err;
            }

            var names = [];
            var patterns = [];
            var matchesMap = {};
            var matches = [];

            function pushMatch(a) {
                var id = a.name + ':' + a.type + ':' + a.value;
                if (!matchesMap[id]) {
                    matchesMap[id] = true;
                    matches.push(a);
                }
            }

            // TODO ANAME for when we want to use a CNAME with a root (such as 'example.com')
            zone.forEach(function(a) {
                if ('*' === a.name[0] && '.' === a.name[1]) {
                    // *.example.com => .example.com (valid)
                    // *example.com => example.com (invalid, but still safe)
                    // TODO clone a
                    a.name = a.name.slice(1);
                }

                if ('.' === a.name[0]) {
                    patterns.push(a);
                } else {
                    names.push(a);
                }
            });

            function byDomainLen(a, b) {
                // sort most to least explicit
                // .www.example.com
                // www.example.com
                // a.example.com
                return (b.name || b.zone).length - (a.name || a.zone).length;
            }

            names.sort(byDomainLen);
            patterns.sort(byDomainLen);

            function testType(q, a) {
                var qtype = ndns.consts.QTYPE_TO_NAME[q.type];

                if (a.type === qtype) {
                    pushMatch(a);
                    return;
                }

                if (-1 !== ['A', 'AAAA'].indexOf(qtype)) {
                    if ('ANAME' === a.type) {
                        // TODO clone a
                        a.realtype = qtype;
                        pushMatch(a);
                    } else if ('CNAME' === a.type) {
                        pushMatch(a);
                    }
                }

                if ('ANY' === qtype) {
                    if ('ANAME' === a.type) {
                        // TODO clone a
                        a.realtype = 'A';
                    }

                    pushMatch(a);
                }
            }

            names.forEach(function(a) {
                request.question.forEach(function(q) {
                    if (a.name !== q.name) {
                        return;
                    }

                    testType(q, a);
                });
            });

            if (!matches.length) {
                patterns.forEach(function(a) {
                    request.question.forEach(function(q) {
                        var isWild;

                        isWild = (a.name === q.name.slice(q.name.length - a.name.length))
                            // should .example.com match example.com if none set?
                            // (which would mean any ANAME must be a CNAME)
                            //|| (a.name.slice(1) === q.name.slice(q.name.length - (a.name.length - 1)))
                        ;

                        if (!isWild) {
                            return;
                        }

                        // TODO clone a
                        a.name = q.name;
                        testType(q, a);
                    });
                });
            }

            return PromiseA.all(matches.map(function(a) {
                if (a.value) {
                    a.values = [a.value];
                }

                // TODO alias value as the appropriate thing?
                var result = {
                    name: a.name,
                    address: a.address || a.value,
                    data: a.data || a.values,
                    exchange: a.exchange || a.value,
                    priority: a.priority || 10,
                    ttl: a.ttl || 600
                };

                if ('CNAME' === a.type) {
                    if (Array.isArray(result.data)) {
                        result.data = result.data[0];
                    }
                    if (!result.data) {
                        console.error('[CNAME ERROR]');
                        console.error(result);
                    }
                }
                // I think the TXT record requires an array
                if ('TXT' === a.type && !Array.isArray(result.data)) {
                    result.data = [result.data];
                }

                return ndns[a.type](result);
            })).then(function(answers) {
                response.answer = response.answer.concat(answers.filter(function(a) {
                    return a;
                }));

                if (response.answer != undefined && response.answer != null && response.answer.length > 0) {
                    if (response.answer.length > 1) {
                        let roundRobinIndex = Math.floor(Math.random() * response.answer.length);
                        response.answer = [response.answer[roundRobinIndex]];
                    }
                    let addressForwardRequest = ReinHardt.getAddressForward(response['answer'][0]['name'], request.address.address);
                    if (addressForwardRequest != null) {
                        response['answer'][0]['address']  = addressForwardRequest;
                        response['answer'][0]['data']  = [addressForwardRequest];
                        response['answer'][0]['exchange']  = addressForwardRequest;
                    }
                    ReinHardt.requestLog(`'${response['answer'][0]['name']}' DNS HAS REQUESTED FROM '${request.address.address}', RESPONSED '${response['answer'][0]['address']}'`);
                }
                // response.send();
                cb();
            });
        });
    }

    function addNs(ndns, conf, store, request, response) {
        conf.nameservers.forEach(function(ns) {
            response.answer.push(ndns.NS({
                name: request.question[0].name,
                data: ns.name,
                ttl: 60 * 60
            }));
            response.additional.push(ndns.A({
                name: ns.name,
                address: ns.ipv4,
                ttl: 60 * 60
            }));
        });
    }

    var handlers = {
        SOA: function(ndns, conf, store, request, response, cb) {
            // See example of
            // dig soa google.com @ns1.google.com

            // TODO auto-increment serial number as epoch timestamp (in seconds) of last record update for that domain
            if (false && /^ns\d\./i.test(name)) {
                /*
                soa.ttl = 60;

                response.authority.push(ndns.NS({
                  name: request.question[0].name
                , data: ns.name
                , ttl: 60 * 60
                }));
                */
            } else {
                response.answer.push(ndns.SOA(getSoa(conf, store, request)));

                addNs(ndns, conf, store, request, response);

                //response.send();
                cb();
            }
        },
        NAPTR: function(ndns, conf, store, request, response, cb) {
            // See example of
            // dig naptr google.com @ns1.google.com

            response.authority.push(ndns.SOA(getSoa(conf, store, request)));
            /*
            response.authority.push(ndns.NAPTR({
              "flags": "aa qr rd"
            }));
            */

            // response.send();
            cb();
        },
        NS: function(ndns, conf, store, request, response, cb) {
            // See example of
            // dig ns google.com @ns1.google.com

            //console.log(Object.keys(response));
            //console.log('response.header');
            //console.log(response.header);
            //console.log('response.authority');
            //console.log(response.authority);

            addNs(ndns, conf, store, request, response);

            cb();
            //response.send();
        },
        A: function(ndns, conf, store, request, response, cb) {
            if (/^local(host)?\./.test(request.question[0].name)) {
                setLocalhost(request, response, '127.0.0.1');
                cb();
                //response.send();
                return;
            }

            handleAll(ndns, conf, store, request, response, cb);
        },
        AAAA: function(ndns, conf, store, request, response, cb) {
            if (/^local(host)?\./.test(request.question[0].name)) {
                setLocalhost(request, response, '::1');
                cb();
                //response.send();
                return;
            }

            handleAll(ndns, conf, store, request, response, cb);
        },
        ANY: function handleAny(ndns, conf, store, request, response, cb) {
            addNs(ndns, conf, store, request, response);

            handleAll(ndns, conf, store, request, response, cb);
        },
        CNAME: handleAll,
        MX: handleAll,
        SRV: handleAll,
        TXT: handleAll,
        any: handleAll
    };

    return function(request, response) {
        // although the standard defines the posibility of multiple queries,
        // in practice there is only one query per request
        var question = response.question[0];
        var wname = question && question.name || '';
        var lname = question && question.name.toLowerCase() || '';
        var typename = ndns.consts.QTYPE_TO_NAME[question && question.type];
        if (question) {
            question.name = lname;
        }
        /*
        if (question && /coolaj86.com$/i.test(question.name)) {
          console.log('\n\n');
          //console.log('request keys', Object.keys(request));
          console.log('request.question:', request.question.map(function (q) {
            q.qtype = ndns.consts.QTYPE_TO_NAME[q.type];
            q.qclass = ndns.consts.QCLASS_TO_NAME[q.class];
            return JSON.stringify(q);
          }));

          console.log('request.additional:', request.additional.map(function (q) {
            q.qtype = ndns.consts.QTYPE_TO_NAME[q.type];
            q.qclass = ndns.consts.QCLASS_TO_NAME[q.class];
            return JSON.stringify(q);
          }));
        }
        */

        // This is THE authority
        response.header.aa = 1;

        if (!handlers[typename]) {
            typename = 'any';
        }

        handlers[typename](ndns, conf, store, request, response, function() {
            var opt;
            var opt2;

            if (request.additional.some(function(q) {
                    // ndns.consts.NAME_TO_QTYPE.OPT // 41
                    if (ndns.consts.NAME_TO_QTYPE.OPT === q.type) {
                        if (opt) {
                            opt2 = q;
                        }
                        opt = q;
                    }
                    return q;
                })) {
                response.header.rcode = ndns.consts.NAME_TO_RCODE.NOERROR; // No Error

                if (0 !== opt.version) {
                    response.header.rcode = ndns.consts.NAME_TO_RCODE.BADVERS; // Bad Version
                }

                if (opt2) {
                    response.header.rcode = ndns.consts.NAME_TO_RCODE.FORMERR; // Format Error
                }

                response.edns_version = 0;
            }

            // 'undefined' === typeof response.edns_version
            //  && -1 !== ['IN', 'A'].indexOf(typename)
            if (!response.answer.length) {
                response.authority.push(ndns.SOA(getSoa(conf, store, request)));
            }

            /*
            if (request.question[0] && /coolaj86.com$/i.test(request.question[0].name)) {
              response.debug = 1;
              console.log('response.header', response.header);
              console.log('response.edns_version', response.edns_version);
              console.log('response.answer', response.answer);
              console.log('response.authority', response.authority);
              console.log('response.additional', response.additional);
            }
            */

            // Because WWw.ExaMPLe.coM increases security...
            // https://github.com/letsencrypt/boulder/issues/1228
            // https://github.com/letsencrypt/boulder/issues/1243
            ['answer', 'additional', 'authority'].forEach(function(atype) {
                response[atype].forEach(function(a) {
                    if (a.name) {
                        a.name = a.name.replace(lname, wname);
                    }
                });
            });

            response.send();
        });
    };
};
