const async = require('async');
const logger = require('@nimacode/core/lib/utils/log').getLogger(__filename);
const util = require('util');

class WantherdressParser{
    /**
     *
     * @param {Array} feed
     */
    constructor(feed) {
        this.feed = feed;
    }

    /**
     * Converting wantherdress feed to amby feed
     * @param {function} done
     */
    process(done){
        async.map(this.feed, (feed, cb) => {
            feed.productPageUrl = this.generateProductPage(feed.slug);
            feed.productOptions = this.generateProductOptions(feed.description);
            feed.collectionIds = [];

            cb(null, feed);
        }, (err, items) => {
            if (err)
                logger.error(err);

            done(items);
        })
    }

    /**
     * Generating amby product page url
     * @param {string} itemId
     */
    generateProductPage(itemId){
        return {
            "base": "https://www.amby.app/",
            "path": util.format('/product-page/%s', itemId)
        }
    }

    /**
     * Generating product options
     * @param {string} description
     */
    generateProductOptions(description){
        const sizeString = description
            ?.replace(/&nbsp;/gi,'')
            ?.split(/<\/?[^>]>Размер:/);
        const formattedSizes = sizeString.length > 1? sizeString[1].split(/<\/?[^>]>/)[0]: undefined;

        if (!formattedSizes)
            return [];
        else {
            const normalSizes = [...new Set(formattedSizes.match(/(XS|S|M|L|XL|XXL)/g))];

            return normalSizes.map(size => {
                return {
                    "value": size,
                    "description": size,
                    "inStock": true,
                    "visible": true
                }
            });
        }
    }
}

module.exports = {
    WantherdressParser
}
