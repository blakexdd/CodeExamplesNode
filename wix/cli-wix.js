const commander = require('commander');
const async = require('async');
const config = require('@nimacode/core/lib/config');
const util = require('util');
const logger = require('@nimacode/core/lib/utils/log').getLogger(__filename);
const Item = require('../../lib/domain').Item;
const saveData = require('../support').saveData;
const WixSupport = require('./wixSupport').WixSupport;
const wixSupport = new WixSupport(config.wix_auth_token);

const categoriesDict = {
    'Для женщин': util.format('%sF', config.wix_size_placeholder_number),
    'Ж_аксессуары': '*F',
    'Ж_обувь': util.format('BOT%sF', config.wix_size_placeholder_string),
    'Ж_плечевая': util.format('TOP%sF', config.wix_size_placeholder_string),
    'Ж_поясная': util.format('BOT%sF', config.wix_size_placeholder_string),
    'Для мужчин': util.format('%sM', config.wix_size_placeholder_number),
    'М_аксессуары': '*M',
    'М_обувь': util.format('BOT%sM', config.wix_size_placeholder_string),
    'М_плечевая': util.format('TOP%sM', config.wix_size_placeholder_string),
    'М_поясная': util.format('BOT%sM', config.wix_size_placeholder_string)
};

/**
 * Collecting wix feed
 * @param {string} output - path to output file
 */
function collectWixFeed(output) {
    wixSupport.generateRawFeed(items => {
        async.mapLimit(items, 4, processFeed, (err, fullFeed) => {
            if (err)
                logger.error('Error processing feed: ', err);

            const feed = fullFeed?.filter(item => item);
            saveData(output, feed);
        });
    });
}

/**
 * Processing item from wix feed
 * @param {Object} feed
 * @param {function} cb
 */
function processFeed(feed, cb) {
    const params = {
        itemId: feed.slug,
        groupId: null,
        name: feed.name,
        created_at: new Date(feed.numericId / 1000),
        updated_at: new Date(feed.lastUpdated),
        description: generateDescription(feed.description, feed.additionalInfoSections),
        url: generateUrl(feed.productPageUrl),
        shortUrl: generateUrl(feed.productPageUrl),
        imageUrl: feed?.media?.mainMedia?.image?.url,
        imageUrls: feed?.media?.items?.map(item => item?.image?.url),
        price: feed.price.discountedPrice,
        oldPrice: feed.price.price,
        inStock: getStockState(feed)
    };

    generateCategory(feed.collectionIds, categories => {
        params['categories'] = categories;

        const sizeTemplates = translateCategories(categories, categoriesDict);

        logger.debug('size templates: ', sizeTemplates);

        if (sizeTemplates.length === 0) {
            cb(null, null);
        }
        else {
            params['tags'] = generateTags(sizeTemplates, feed.productOptions);

            logger.debug('Loading item: ', feed.name);

            const newItem = new Item(params);

            if (params['tags'].length > 0 && params['tags'][0]) {
                cb(null, newItem);
            }
            else {
                cb(null, null);
            }
        }
    });
}

/**
 * Getting stock state for item
 * @param {Object} feed
 */
function getStockState(feed) {
    if (!feed?.visible)
        return false;
    else
        return feed?.stock?.inStock;
}

/**
 * Translating categories from raw russian to filter format
 * @param {Array} categories - item categories
 * @param {Object} categoriesDict - translation dict
 * @return {Array}
 */
function translateCategories(categories, categoriesDict) {
    let sizeTemplates = [];

    for (const category of categories)
        if (categoriesDict.hasOwnProperty(category))
            sizeTemplates.push(categoriesDict[category]);

    return sizeTemplates;
}

/**
 * Generating tags for feed
 * @param {Array} sizeTemplates - filter formatted templates
 * @param {Array} productOptions - items options extracted from wix
 * @return {Array}
 */
function generateTags(sizeTemplates, productOptions) {
    const choices = productOptions.filter(option => option.name === 'Размер')[0]?.choices;
    const sizes = [...new Set(choices?.map(choice => choice.description.split('/')).flat(Infinity))];
    const gender = sizeTemplates.map(sizeTemplate => sizeTemplate.match(/(F|M)$/))[0][0];
    const sizes_string = sizes.join(' ').replace('М', 'M');
    const formatted_sizes = [];

    if (sizes_string.match(/one size/i) || sizeTemplates.join(' ').match(/\*[FMМ]/))
        formatted_sizes.push(util.format('*%s', gender));
    else if (sizes_string.match(/\d+/))
        formatted_sizes.push(generateSizes(sizeTemplates, sizes, config.wix_size_placeholder_number));
    else if (sizes_string.match(/\w+/))
        formatted_sizes.push(generateSizes(sizeTemplates, sizes, config.wix_size_placeholder_string));

    return formatted_sizes.flat(Infinity);
}

/**
 * Generates sizes for filter
 * @param {Array} sizeTemplates - filter formatted templates
 * @param {Array} sizes - sizes extracted from wix
 * @param {String} size_pattern - pattern to change
 * @return {Array}
 */
function generateSizes(sizeTemplates, sizes, size_pattern) {
    const matching_template = sizeTemplates.filter(sizeTemplate => sizeTemplate.match(new RegExp(size_pattern)))[0];

    return sizes.map(size => matching_template?.replace(size_pattern, size));
}

/**
 * Generating full description from main description and sub description
 * @param {string} description - main item description
 * @param {Array} additionalInfo - additional info with title and description
 * @returns {string}
 */
function generateDescription(description, additionalInfo) {
    let fullDescription = util.format('%s\n', description);

    for (const info of additionalInfo)
        fullDescription += util.format('%s\n%s\n', info.title, info.description);

    const clearDesc = fullDescription
        .replace(/<\/p><p>/g, "\n")
        .replace(/<br\/?>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/Основные характеристики:/, "\n")
        .split(/Доставка/)[0]
        .replace(/\n+/g, '\n');

    if (clearDesc[0] === '\n')
        return clearDesc.replace('\n', '');

    return clearDesc;
}

/**
 * Generating url from host and path name
 * @param {Object} productPageUrl - url object consists of host and path
 * @returns {string}
 */
function generateUrl(productPageUrl) {
    return util.format('%s%s', productPageUrl.base.slice(0, -1), productPageUrl.path);
}

/**
 * Generating categories of item
 * @param {Array} collectionIds
 * @param {function} done
 */
function generateCategory(collectionIds, done) {
    async.mapLimit(collectionIds, 4, processCollection, (err, collections) => {
        if (err)
            logger.error('Error generating category: ', err);

        done(collections);
    });
}
/**
 * Processing collection
 * @param {string} id
 * @param {function} cb
 */
function processCollection(id, cb) {
    wixSupport.getCollection(id, cb);
}

commander.version('0.3');

commander.command('collect')
    .description('Collect wix feed')
    .option('--output <output_file>', 'wix feed file', './data/amby.app/feed.json')
    .action(cmd => {
        collectWixFeed(cmd.output);
    });

commander.parse(process.argv);