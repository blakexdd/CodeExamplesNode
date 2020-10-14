const request = require('request');
const config = require('@nimacode/core/lib/config');
const logger = require('@nimacode/core/lib/utils/log').getLogger(__filename);
const async = require('async');
const util = require('util');
const domain = require('@nimacode/core/lib/domain');
const blogger = require('@nimacode/core/lib/utils/log').getBlogger();
const fs = require('fs');
const csv = require('csv');

class WixSupport{
    /**
     *
     * @param {string} auth_token - wix authentication token
     */
    constructor(auth_token) {
        this.auth_token = auth_token;
        this.body = {
            "query": {
                "paging": {
                    "offset": -100
                }
            },
            "includeVariants": false,
            "includeHiddenProducts": true
        };
        this.csvHeaders = ['handleId', 'fieldType', 'name', 'description', 'productImageUrl', 'collection',
            'sku', 'ribbon', 'price', 'surcharge', 'visible', 'discountMode', 'discountValue',
            'productOptionName2', 'productOptionType2', 'productOptionDescription2'];
        this.getAllCollections((err, collections) => {
            if (err)
                logger.error(err);

            this.collections = collections;
        });
    }

    getCsvHeaders(){
        return this.csvHeaders;
    }

    /**
     * Save data to file
     * @param {Array[]} data
     * @param {string} path
     * @param {string} partner
     * @param {function} done
     */
    save(data, path , partner, done){
        csv.stringify(data, { delimiter: ',' }, (err, output) => {
            if (err)
                logger.error(err);

            fs.writeFile(path, output.trim(), err => {
                if (err)
                    logger.error(err);

                blogger.info(util.format("🚨 Пожалуйтса, обновите фид *%s*: ", partner), {
                    file: fs.readFileSync(path),
                    filename: "export.csv",
                    channel: config.slack_feed_update_channel
                });

                done();
            });
        });
    }

    /**
     * Reading csv file
     * @param {string} path
     * @param {function} done
     */
    readData(path, done){
        fs.access(path, err => {
            if (err){
                fs.writeFileSync(path, '');
                done(null, []);
            }else
                fs.readFile(path, (err, data) => {
                    if (err)
                        done(err);
                    else
                        csv.parse(data, (err, output) => {
                            if (err)
                                done(err);
                            else
                                done(null, output);
                        });
                });
        });
    }

    /**
     * Generating options for wix request
     * @param {string} url - request url
     * @param {string} method - request method
     * @param {string} body - stringified body object
     * @returns {Object}
     */
    generateOptions(url, method, body= ''){
        const params = {
            url: url,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': this.auth_token
            }
        }

        if (body !== '')
            Object.assign(params, {body: body});

        return params;
    }

    /**
     * Retrieving all feed from wix (wix has 100 items per request limitation)
     * @param {function} done
     */
    generateRawFeed(done){
        const feedItems = [];
        let emptyPage = false;

        async.whilst((cb) => {cb(null, !emptyPage)},
            (cb1) => {
                const body = this.body;
                body.query.paging.offset += 100;

                const options = this.generateOptions(config.wix_products_url,
                    "POST", JSON.stringify(body));

                logger.debug('Requesting with offset: ', body.query.paging.offset);

                request(options, (err, res, body) => {
                    if (err)
                        logger.error("Error requesting: ", err);

                    if (!res || res?.statusCode !== 200)
                        logger.error('Error getting feed: ', res?.statusCode);
                    else{
                        const items = JSON.parse(body).products;

                        if (items && items.length !== 0){
                            feedItems.push(...items);
                            cb1(null);
                        }
                        else{
                            emptyPage = true;
                            cb1(null);
                        }
                    }
                });
            }, (err, _) => {
                if (err)
                    logger.error(err);

                done(feedItems);
            });
    }

    /**
     * Retrieving wix collection
     * @param {string} id
     * @param {function} done
     */
    getCollection(id, done){
        const foundCollection = this.collections?.filter(coll => coll.id === id);

        if (foundCollection && foundCollection.length > 0)
            done(null, foundCollection[0].name);
        else
            done(null, null);
    }

    /**
     * Getting all item's collections
     * @param {function} done
     */
    getAllCollections(done){
        const url = util.format('%s/query', config.wix_collections_url);
        const options = this.generateOptions(url, 'POST');

        request(options, (err, res, body) => {
            if (err)
                logger.error("Error getting collections: ", err);

            if (res?.statusCode !== 200)
                done(res?.statusCode);

            done(null, JSON.parse(body).collections);
        });
    }

    /**
     * Resizing images
     * @param {String[]} images - image urls
     * @param {function} done
     */
    resizeImages(images, done){
        async.mapLimit(images, 4,(image, cb) => {
            const imageUri = image.replace('https://', '');
            domain.db.files.gs().fileExists(imageUri, exist => {
                const newUrl = util.format('https://storage.googleapis.com/amby/%s', imageUri);
                logger.debug('Exists: ', exist);

                if (!exist)
                    domain.db.files.gs().uploadFile(image, () => {
                        cb(null, newUrl);
                    });
                else
                    cb(null, newUrl);
            });
        }, (err, newImages) => {
            if (err)
                logger.debug('Error: ', err);

            done(newImages.join(';'));
        });
    }

    /**
     * Getting updated on site item description
     * @param {Object} ambyItem
     * @param {function} done
     */
    getUpdatedDescription(ambyItem, done){
        done(ambyItem?.description);
    }

    /**
     * Getting updated on site item sizes
     * @param {Object} ambyItem
     * @param {function} done
     */
    getUpdatedSizes(ambyItem, done){
        const sizesAmby = ambyItem?.productOptions
            ?.filter(option => option.name === 'Размер');

        done(sizesAmby && sizesAmby.length > 0? sizesAmby[0].choices?.map(choice => choice.description)?.join(';'): undefined);
    }

    /**
     * Getting updated on site item collections
     * @param {Object} ambyItem
     * @param {function} done
     */
    getUpdatedCollections(ambyItem, done){
        async.map(ambyItem?.collectionIds, (collection, cb1) => {
            this.getCollection(collection, (err, collName) => {
                if (err)
                    logger.error(err);

                cb1(null, collName);
            });
        }, (err, collections) => {
            if (err)
                logger.error(err);

            done(collections?.join(';'));
        })
    }

    /**
     * Getting updated stock item
     * @param {Object} ambyItem
     */
    getUpdatedStockState(ambyItem){
        if (!ambyItem?.visible)
            return 'FALSE';

        if (!ambyItem?.stock?.inStock)
            return 'FALSE';
        else
            return 'TRUE';
    }


    /**
     * Updating existing product
     * @param {string} productId - id generated by wix
     * @param {Object} product - updated product
     * @param {function} done
     */
    updateProduct(productId, product, done){
        const url = productId !== '' ?
            util.format('%s/%s', config.wix_get_product_url, productId): config.wix_get_product_url;
        const body = JSON.stringify({
            "product": product
        });
        const options = productId === '' ?
            this.generateOptions(url, 'POST', body): this.generateOptions(url, 'PATCH', body);

        request(options, (err, res, body) => {
            if (err)
                logger.error("Error updating product: ", err);

            if (res.statusCode !== 200)
                done(res.statusCode)

            done(null, JSON.parse(body));
        });
    }

    /**
     * Updating existing products media
     * @param {string} productId - id generated by wix
     * @param {Object} media - products media
     * @param {function} done
     */
    updateMedia(productId, media, done){
        const url = util.format('%s/%s/choices/media',config.wix_get_product_url, productId);
        const body = JSON.stringify({
            "media": media
        })
        const options = this.generateOptions(url, 'PATCH', body);

        request(options, (err, res, body) => {
            if (err)
                logger.error("Error updating media: ", err);

            if (res.statusCode !== 200)
                done(res.statusCode)

            done(null);
        });
    }
}

module.exports = {
    WixSupport
}