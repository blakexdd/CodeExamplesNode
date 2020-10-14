const fs = require('fs');
const { google } = require('googleapis');
const sheets = google.sheets({ version: 'v4' });
const util = require('util');
const config = require('@nimacode/core/lib/config');
const logger = require('@nimacode/core/lib/utils/log').getLogger(__filename);

const SCOPES = ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/spreadsheets'];
const CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || __dirname + '/credentials.json';
const auth = new google.auth.GoogleAuth({ scopes: SCOPES, keyFilename: CREDENTIALS });

/**
 * @param {object[]} users_db
 * @param {Object} sheetSettings
 * @param {function(object[], object):any} callback callback function
 */
function authorize(users_db, sheetSettings, callback) {
    auth.getClient().then(authClient => {
        google.options({ auth: authClient });
        callback(users_db, sheetSettings);
    });
}

/**
 * @param {object[]} users
 * @param {Object} sheetSettings
 * @param {function(Object): any} [update_func] updating sheets function
 */
function execAdding(users, sheetSettings, update_func) {
    authorize(users, sheetSettings, update_func);
}

/**
 * @param {object[]} users_db
 * @param {Object} sheetSettings
 */
function updateDataSheet(users_db, sheetSettings) {
    logger.debug('Adding update data sheet', sheetSettings);
    execAdding(users_db, sheetSettings, updateUsers);
}

/**
 * @param {object[]} users
 * @param {Object} sheetSettings
 */
function addDataSheet(users, sheetSettings) {
    logger.debug('Adding data sheet');
    execAdding(users, sheetSettings, addUsers);
}


/**
 * @param {object[]} users
 * @param {Object} sheetSettings
 */
function addUsers(users, sheetSettings) {
    const end_range_number = users.length + 1;
    const sorted_users = users.sort((a, b) => a[4] - b[4]);

    sheets.spreadsheets.values.update({
        spreadsheetId: config.google_sheet_id,
        range: util.format('%s!%s:%s%s', sheetSettings.tab_name,
            sheetSettings.start_range, sheetSettings.end_range, end_range_number),
        resource: {
            values: sorted_users
        },
        valueInputOption: 'RAW',
    }, (err, response) => {
        if (err) {
            logger.error("Error adding user: ", err);
        }

    });

}

/**
 * @param {Array} users_db
 * @param {Object} sheetSettings
 * @param {function(Object): any} [done] callback function
 */
function prepareUsers(users_db, sheetSettings, done) {
    let unsubscribedUsers = [];

    if (fs.existsSync(config.unsubscribed_users_file)) {
        unsubscribedUsers = fs.readFileSync(config.unsubscribed_users_file).toString().split('\n');
        fs.writeFileSync(config.unsubscribed_users_file, '');
    }
    else {
        logger.error('Error finding file: ', config.unsubscribed_users_file);
        logger.error('Root dir path:', process.cwd());
        logger.error('Data dir:', fs.readdirSync('./data'));
    }

    sheets.spreadsheets.values.get({
        spreadsheetId: sheetSettings.sheet_id,
        range: util.format('%s!%s:%s', sheetSettings.tab_name,
            sheetSettings.start_range, sheetSettings.end_range)
    }, (err, response) => {
        if (err)
            logger.error('Error getting users: ', err);

        const users_google = response.data.values?.map(user => {
            if (!user[6])
                user[6] = "UNDEFINED";

            return user;
        });
        const users_google_ids = users_google?.map(user => user[6].split(';')[0].slice(1, -1)) || [];

        const usersToUpdate = unsubscribeUsers(users_google || [], unsubscribedUsers);
        const usersToAdd = addUsersToCohorts(users_db || [], users_google_ids);
        const allUsers = usersToUpdate.concat(usersToAdd);

        done(allUsers);
    });
}

/**
 * Unsubscribe users in google sheet
 * @param {Array} sheet_users
 * @param {Array} unsubscribed_users
 * @returns {Array}
 */
function unsubscribeUsers(sheet_users, unsubscribed_users) {
    let users_to_update = [];

    for (const user of sheet_users) {
        const users_google_ids = user[0]?.split('[')[1]?.split(']')[0];
        const idx_of_unsubscribed_user = unsubscribed_users?.indexOf(users_google_ids, 0);
        let cohort = idx_of_unsubscribed_user === -1 ? user[1] : 'отписан';

        logger.trace('User: ', user[0]);
        logger.trace('Cohort: ', cohort);

        user[1] = cohort;
        user[6] = user[6].match(/#/) ? 'UNDEFINED' : util.format("'%s';'%s'", users_google_ids, cohort);
        logger.trace('Users cohort: ', cohort);

        users_to_update.push(user);
    }
    return users_to_update;
}

/**
 * Adding users from db to google sheets
 * @param {Array} users_db
 * @param {Array} users_google_ids
 * @returns {Array}
 */
function addUsersToCohorts(users_db, users_google_ids) {
    let users_to_add = [];

    for (const user of users_db) {
        const idx_of_user_in_sheets = users_google_ids.indexOf(user.user_id);

        if (idx_of_user_in_sheets === -1) {
            const cohort = config.google_sheets_default_cohort;
            const users_id_cohort = util.format("'%s';'%s'", user.user_id, cohort);
            const users_info = util.format('%s [%s] %s', user.name, user.user_id, user.locale);

            users_to_add.push([users_info,
                cohort, '', user.platform, '', '', users_id_cohort]);
        }
    }

    return users_to_add;
}

/**
 * @param {Array} users_db
 * @param {Object} sheetSettings
 */
function updateUsers(users_db, sheetSettings) {
    prepareUsers(users_db, sheetSettings, (users) => {
        logger.trace('Number of users: ', users.length);
        logger.trace('First 10 users: ', users.slice(1, 10));

        sheets.spreadsheets.values.update({
            spreadsheetId: config.google_sheet_id,
            range: util.format('%s!%s:%s', sheetSettings.tab_name,
                sheetSettings.start_range, sheetSettings.end_range),
            resource: {
                values: users
            },
            valueInputOption: 'RAW',
        }, (err, response) => {
            if (err) {
                logger.error('Error updating users', err);
            }
            logger.debug('Updated users successfully', response.data);
            process.exit();
        });
    });
}


module.exports = {
    updateDataSheet: updateDataSheet,
    addDataSheet: addDataSheet
};
