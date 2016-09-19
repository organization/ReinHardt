'use strict';

module.exports.create = function(opts) {
    opts = opts || {};
    opts.filepath = opts.filepath || require('path').join(process.cwd, 'db.sqlite3');

    var Db = new(require('sqlite3').Database)(opts.filepath);

    var wrap = require('masterquest-sqlite3');

    var dir = [
        // TODO consider zones separately from domains
        // i.e. jake.smithfamily.com could be owned by jake alone
        {
            tablename: 'domains',
            idname: 'id' // crypto random
                ,
            indices: [
                'createdAt', 'updatedAt', 'deletedAt', 'revokedAt', 'zone', 'name', 'type', 'value', 'device', 'groupIdx'
            ],
            hasMany: ['accounts', 'groups']
        }, {
            tablename: 'accounts_domains',
            idname: 'id',
            indices: [
                'createdAt', 'updatedAt', 'deletedAt', 'revokedAt', 'accountIdx', 'zone'
            ],
            hasMany: ['accounts', 'domains']
        }, {
            tablename: 'domains_groups',
            idname: 'id',
            indices: [
                'createdAt', 'updatedAt', 'deletedAt', 'revokedAt', 'accountId', 'accountIdx'
            ],
            hasMany: ['domains', 'groups']
        }
    ];

    return wrap.wrap(Db, dir);
};
