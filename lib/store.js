'use strict'

/**
 * @class NGN.DATA.Store
 * Represents a collection of data.
 * @fires record.create
 * Fired when a new record is created. The new
 * record is provided as an argument to the event
 * handler.
 * @fires record.delete
 * Fired when a record(s) is removed. The old record
 * is provided as an argument to the event handler.
 */
class Store extends NGN.Class {
  constructor (cfg) {
    cfg = cfg || {}
    super(cfg)

    Object.defineProperties(this, {
      /**
       * @cfg {NGN.DATA.Model} model
       * An NGN Data Model to which data records conform.
       */
      model: NGN.define(true, false, false, cfg.model || null),

      // The raw data collection
      _data: NGN.define(false, true, false, []),

      // The raw filters
      _filters: NGN.define(false, true, false, []),

      // The raw indexes
      _index: NGN.define(false, true, false, cfg.index || []),

      // Placeholders to track the data that's added/removed
      // during the lifespan of the store. Modified data is
      // tracked within each model record.
      _created: NGN.define(false, true, false, []),
      _deleted: NGN.define(false, true, false, []),
      _loading: NGN.define(false, true, false, false),

      /**
       * @property {NGN.DATA.Proxy} proxy
       * The proxy used to transmit data over a network.
       * @private
       */
      proxy: NGN.define(false, true, false, null),

      /**
       * @cfg {boolean} [allowDuplicates=true]
       * Set to `false` to prevent duplicate records from being added.
       * If a duplicate record is added, it will be ignored and an
       * error will be thrown.
       */
      allowDuplicates: NGN.define(true, true, false, NGN.coalesce(cfg.allowDuplicates, true)),

      /**
       * @cfg {boolean} [errorOnDuplicate=false]
       * Set to `true` to throw an error when a duplicate record is detected.
       * If this is not set, it will default to the value of #allowDuplicates.
       * If #allowDuplicates is not defined either, this will be `true`
       */
      errorOnDuplicate: NGN.define(true, false, false, NGN.coalesce(cfg.errorOnDuplicate, cfg.allowDuplicates, true))
    })

    var obj = {}
    this._index.forEach(function (i) {
      obj[i] = []
    })
    this._index = obj

    let events = [
      'record.duplicate',
      'record.create',
      'record.update',
      'record.delete',
      'clear',
      'filter.create',
      'filter.delete',
      'index.create',
      'index.delete'
    ]

    let me = this
    events.forEach(function (evt) {
      me.on(evt, NGN.BUS.attach(evt))
    })
  }

  /**
   * @property {array} data
   * The complete and unfiltered raw underlying dataset. This data
   * is usually persisted to a database.
   * @readonly
   */
  get data () {
    return this._data.map(function (d) {
      return d.data
    })
  }

  /**
   * @property {array} records
   * An array of NGN.DATA.Model records. If the store has
   * filters applied, the records will reflect the filtration.
   * @readonly
   */
  get records () {
    return this.applyFilters(this._data)
  }

  /**
   * @property recordCount
   * The total number of #records in the collection.
   * @readonly
   */
  get recordCount () {
    return this.applyFilters(this._data).length
  }

  /**
   * @method add
   * Add a data record.
   * @param {NGN.DATA.Model|object} data
   * Accepts an existing NGN Data Model or a JSON object.
   * If a JSON object is supplied, it will be applied to
   * the data model specified in cfg#model. If no model
   * is specified, the raw JSON data will be stored.
   * @param {boolean} [suppressEvent=false]
   * Set this to `true` to prevent the `record.create` event
   * from firing.
   */
  add (data, suppressEvent) {
    let rec
    let me = this
    if (!(data instanceof NGN.DATA.Entity)) {
      try { data = JSON.parse(data) } catch (e) {}
      if (typeof data !== 'object') {
        throw new Error('Cannot add a non-object record.')
      }
      if (this.model) {
        rec = new this.model(data) // eslint-disable-line new-cap
      } else {
        rec = data
      }
    } else {
      rec = data
    }
    if (rec.hasOwnProperty('_store')) {
      rec._store = me
    }
    let dupe = this.isDuplicate(rec)
    if (dupe) {
      this.emit('record.duplicate', rec)
      if (!this.allowDuplicates) {
        if (this.errorOnDuplicate) {
          throw new Error('Cannot add duplicate record (allowDuplicates = false).')
        }
        return
      }
    }
    this.listen(rec)
    this.applyIndices(rec, this._data.length)
    this._data.push(rec)
    !this._loading && this._created.indexOf(rec) < 0 && this._created.push(rec)
    !NGN.coalesce(suppressEvent, false) && this.emit('record.create', rec)
  }

  /**
   * @method isDuplicate
   * Indicates whether the specified record is a duplicate.
   * This compares checksum values. Any match is considered a
   * duplicate. It will also check for duplication of raw JSON
   * objects (i.e. non-NGN.DATA.Model records).
   * @param  {NGN.DATA.Model|Object} record
   * The record or JSON object.
   * @return {boolean}
   */
  isDuplicate (record) {
    if (this._data.indexOf(record) >= 0) {
      return false
    }
    return this._data.filter(function (rec) {
      return rec.checksum === record.checksum
    }).length > 0
  }

  /**
   * @method listen
   * Listen to a specific record's events and respond.
   * @param {NGN.DATA.Model} record
   * The record to listen to.
   * @fires record.update
   * Fired when a record is updated. The #record is passed as an argument to
   * the event handler.
   * @private
   */
  listen (record) {
    let me = this
    record.on('field.update', function (delta) {
      me.updateIndice(delta.field, delta.old, delta.new, me._data.indexOf(record))
      me.emit('record.update', record)
    })
    record.on('field.delete', function (delta) {
      me.updateIndice(delta.field, delta.old, undefined, me._data.indexOf(record))
      me.emit('record.update', record)
    })
  }

  /**
   * @method bulk
   * Bulk load data.
   * @param {string} eventName
   * @param {array} data
   * @private
   */
  bulk (event, data) {
    this._loading = true
    let me = this
    data.forEach(function (rec) {
      me.add(rec, true)
    })
    this._loading = false
    this._deleted = []
    this._created = []
    this.emit(event || 'load')
  }

  /**
   * @method load
   * Bulk load data. This acts the same as adding records,
   * but it suppresses individual record creation events.
   * This will add data to the existing collection. If you
   * want to load fresh data, use the #reload method.
   * @param {array} data
   * An array of data. Each array element should be an
   * NGN.DATA.Model or a JSON object that can be applied
   * to the store's #model.
   */
  load () {
    let array = Array.isArray(arguments[0]) ? arguments[0] : NGN._slice(arguments)
    this.bulk('load', array)
  }

  /**
   * @method reload
   * Reload data. This is the same as running #clear followed
   * by #load.
   */
  reload (data) {
    this.clear()
    let array = Array.isArray(arguments[0]) ? arguments[0] : NGN._slice(arguments)
    this.bulk('reload', array)
  }

  /**
   * @method indexOf
   * Find the index number of a record within the collection.
   * @param  {NGN.DATA.Mode} record
   * The record whose index should be identified.
   * @return {Number}
   * Returns a number from `0-collection length`. Returns `-1` if
   * the record is not found in the collection.
   */
  indexOf (record) {
    if (typeof record !== 'object' || (!(record instanceof NGN.DATA.Model) && !record.checksum)) {
      return -1
    }
    return this._data.findIndex(function (el) {
      return el.checksum === record.checksum
    })
  }

  /**
   * @method contains
   * A convenience method that indicates whether a record is in
   * the store or not.
   * @param {NGN.DATA.Model} record
   * The record to check for inclusion in the data collection.
   * @return {Boolean}
   */
  contains (record) {
    return this.indexOf(record) >= 0
  }

  /**
   * @method remove
   * Remove a record.
   * @param {NGN.DATA.Model|object|number} data
   * Accepts an existing NGN Data Model, JSON object,
   * or index number. Using a JSON object is slower
   * than using a reference to a data model or an index
   * number (index is fastest).
   * @fires record.delete
   */
  remove (data, suppressEvents) {
    let removed = []
    let num

    if (typeof data === 'number') {
      num = data
    } else if (data && data.checksum && data.checksum !== null || data instanceof NGN.DATA.Model) {
      num = this.indexOf(data)
    } else {
      let m = new this.model(data, true) // eslint-disable-line new-cap
      num = this._data.findIndex(function (el) {
        return el.checksum === m.checksum
      })
    }

    // If no record is found, the operation fails.
    if (num < 0) {
      throw new Error('Record removal failed (record not found at index ' + (num || '').toString() + ').')
    }

    removed = this._data.splice(num, 1)

    if (removed.length > 0) {
      removed = removed[0]
      this.unapplyIndices(num)
      if (!this._loading) {
        let i = this._created.indexOf(removed)
        if (i >= 0) {
          i >= 0 && this._created.splice(i, 1)
        } else if (this._deleted.indexOf(removed) < 0) {
          this._deleted.push(removed)
        }
      }

      !NGN.coalesce(suppressEvents, false) && this.emit('record.delete', removed)
    }
  }

  /**
   * @method clear
   * Removes all data.
   * @fires clear
   * Fired when all data is removed
   */
  clear () {
    this._data = []
    let me = this
    Object.keys(this._index).forEach(function (index) {
      me._index[index] = []
    })
    this.emit('clear')
  }

  /**
   * @method find
   * Retrieve a specific record or set of records.
   * @param {number|function|string|object} [query=null]
   * When this is set to a `number`, the corresponding zero-based
   * record will be returned. A `function` can also be used, which
   * acts like a filter. Each record is passed to this function.
   *
   * For example, if we want to find all administrators within a
   * set of users, the following could be used:
   *
   * ```js
   *   var record = MyStore.find(function (record) {
   *     return record.usertype = 'admin'
   *   })
   * ```
   *
   * It's also possible to supply a String. When this is supplied,
   * the store will look for a record whose ID (see NGN.DATA.Model#idAttribute)
   * matches the string. Numberic ID's are matched on their string
   * equivalent for search purposes (data is not modified).
   *
   * An object can be used to search for specific field values. For example:
   *
   * ```js
   * MyStore.find({
   *   firstname: 'Corey',
   *   lastname: /Butler|Doe/
   * })
   * ```
   *
   * The code above will find everyone named Corey Butler or Corey Doe. The
   * first attribute must match the value exactly whereas `lastname` will
   * match against the regular expression.
   *
   * If this parameter is `undefined` or `null`, all records will be
   * returned (i.e. no search criteria specified, so return everything).
   *
   * If you're using a large dataset, indexing can speed up queries. To take
   * full advantage of indexing, all of the query elements should be indexed.
   * For example, if you have `lastname`, 'firstname' in your query and
   * both of those are indexed, the response time will be substantially faster
   * than if they're not (in large data sets). However; if one of those
   * elements is _not_ indexed, performance may not increase.
   * @param {boolean} [ignoreFilters=false]
   * Set this to `true` to search the full unfiltered record set.
   * @return {NGN.DATA.Model|array|null}
   * An array is returned when a function is specified for the query.
   * Otherwise the specific record is return. This method assumes
   * records have unique ID's.
   */
  find (query, ignoreFilters) {
    if (this._data.length === 0) {
      return []
    }
    let res = []
    let me = this
    switch (typeof query) {
      case 'function':
        res = this._data.filter(query)
        break
      case 'number':
        res = (query < 0 || query >= this._data.length) ? null : this._data[query]
        break
      case 'string':
        let i = this.getIndices(this._data[0].idAttribute, query.trim())
        if (i !== null && i.length > 0) {
          i.forEach(function (index) {
            res.push(me._data[index])
          })
          return res
        }
        let r = this._data.filter(function (rec) {
          return (rec[rec.idAttribute] || '').toString().trim() === query.trim()
        })
        res = r.length === 0 ? null : r[0]
        break
      case 'object':
        if (query instanceof NGN.DATA.Model) {
          if (this.contains(query)) {
            return query
          }
          return null
        }
        let match = []
        let noindex = []
        let keys = Object.keys(query)

        keys.forEach(function (field) {
          var index = me.getIndices(field, query[field])
          if (index) {
            match = match.concat(index || [])
          } else {
            field !== null && noindex.push(field)
          }
        })

        // Deduplicate
        match.filter(function (index, i) {
          return match.indexOf(index) === i
        })

        // Get non-indexed matches
        if (noindex.length > 0) {
          res = this._data.filter(function (record, i) {
            if (match.indexOf(i) >= 0) {
              return false
            }
            for (var x = 0; x < noindex.length; x++) {
              if (record[noindex[x]] !== query[noindex[x]]) {
                return false
              }
            }
            return true
          })
        }

        // If a combined indexable + nonindexable query
        res = res.concat(match.map(function (index) {
          return me._data[index]
        })).filter(function (record) {
          for (let y = 0; y < keys.length; y++) {
            if (query[keys[y]] !== record[keys[y]]) {
              return false
            }
          }
          return true
        })
        break
      default:
        res = this._data
    }
    if (res === null) {
      return null
    }
    !NGN.coalesce(ignoreFilters, false) && this.applyFilters(res instanceof Array ? res : [res])
    return res
  }

  /**
   * @method applyFilters
   * Apply filters to a data set.
   * @param {array} data
   * The array of data to apply filters to.
   * @private
   */
  applyFilters (data) {
    if (this._filters.length === 0) {
      return data
    }
    this._filters.forEach(function (filter) {
      data = data.filter(filter)
    })
    return data
  }

  /**
   * @method addFilter
   * Add a filter to the record set.
   * @param {function} fn
   * The filter function. This function should comply
   * with the [Array.filter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter) specification,
   * returning a boolean value.
   * The item passed to the filter will be the NGN.DATA.Model specified
   * in the cfg#model.
   * @fires filter.create
   * Fired when a filter is created.
   */
  addFilter (fn) {
    this._filters.push(fn)
    this.emit('filter.create', fn)
  }

  /**
   * @method removeFilter
   * Remove a filter from the record set.
   * @param {function|index} filter
   * This can be the function which was originally passed to
   * the #addFilter method, or the zero-based #filters index
   * @param {boolean} [suppressEvents=false]
   * Prevent events from firing one the creation of the filter.
   * @fires filter.delete
   * Fired when a filter is removed.
   */
  removeFilter (fn, suppressEvents) {
    suppressEvents = NGN.coalesce(suppressEvents, false)
    let removed = []
    if (typeof fn === 'number') {
      removed = this._filters.splice(fn, 1)
    } else {
      removed = this._filters.splice(this._filters.indexOf(fn), 1)
    }
    removed.length > 0 && !suppressEvents && this.emit('filter.delete', removed[0])
  }

  /**
   * @method clearFilters
   * Remove all filters.
   * @param {boolean} [suppressEvents=false]
   * Prevent events from firing one the removal of each filter.
   */
  clearFilters (suppressEvents) {
    suppressEvents = NGN.coalesce(suppressEvents, false)
    if (suppressEvents) {
      this._filters = []
      return
    }
    let me = this
    while (this._filters.length > 0) {
      me.emit('filter.delete', this._filters.pop())
    }
  }

  /**
   * @method deduplicate
   * Deduplicates the recordset. This compares the checksum of
   * each of the records to each other and removes duplicates.
   * This suppresses the removal
   * @param {boolean} [suppressEvents=true]
   * Suppress the event that gets fired when a record is removed.
   */
  deduplicate (suppressEvents) {
    suppressEvents = NGN.coalesce(suppressEvents, true)
    let records = this.data.map(function (rec) {
      return JSON.stringify(rec)
    })
    let dupes = []
    let me = this
    records.forEach(function (record, i) {
      if (records.indexOf(record) < i) {
        dupes.push(me.find(i))
      }
    })
    dupes.forEach(function (duplicate) {
      me.remove(duplicate)
    })
  }

  /**
   * @method sort
   * Sort the #records. This forces a #reindex, which may potentially be
   * an expensive operation on large data sets.
   * @param {function|object} sorter
   * Using a function is exactly the same as using the
   * [Array.sort()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort?redirectlocale=en-US&redirectslug=JavaScript%2FReference%2FGlobal_Objects%2FArray%2Fsort) method
   * (this is the compare function). The arguments passed to the
   * method are NGN.DATA.Model objects.
   * Alternatively, it is possible to sort by one or more model
   * attributes. Each attribute For example:
   *
   * ```js
   * var Person = new NGN.DATA.Model({
   *   fields: {
   *     fname: null,
   *     lname: null
   *   }
   * })
   *
   * var People = new NGN.DATA.Store({
   *   model: Person
   * })
   *
   * People.add({
   *   fname: 'John',
   *   lname: 'Doe',
   *   age: 37
   * }, {
   *   fname: 'Jane',
   *   lname: 'Doe',
   *   age: 36
   * }, {
   *   fname: 'Jane',
   *   lname: 'Vaughn',
   *   age: 42
   * })
   *
   * People.sort({
   *   lname: 'asc',  // Sort by last name in normal alphabetical order.
   *   age: 'desc'    // Sort by age, oldest to youngest.
   * })
   *
   * People.records.forEach(function (p) {
   *   console.log(fname, lname, age)
   * })
   *
   * // DISPLAYS
   * // John Doe 37
   * // Jane Doe 36
   * // Jane Vaughn 42
   *
   * People.sort({
   *   age: 'desc',  // Sort by age, oldest to youngest.
   *   lname: 'asc'  // Sort by name in normal alphabetical order.
   * })
   *
   * People.records.forEach(function (p) {
   *   console.log(fname, lname, age)
   * })
   *
   * // DISPLAYS
   * // Jane Vaughn 42
   * // John Doe 37
   * // Jane Doe 36
   * ```
   *
   * It is also posible to provide complex sorters. For example:
   *
   * ```js
   * People.sort({
   *   lname: 'asc',
   *   age: function (a, b) {
   *     if (a.age < 40) {
   *       return 1
   *     }
   *     return a.age < b.age
   *   }
   * })
   * ```
   *
   * The sorter above says "sort alphabetically by last name,
   * then by age where anyone under 40yrs old shows up before
   * everyone else, but sort the remainder ages in descending order.
   */
  sort (fn) {
    if (typeof fn === 'function') {
      this.records.sort(fn)
    } else if (typeof fn === 'object') {
      let keys = Object.keys(fn)
      this.records.sort(function (a, b) {
        for (let i = 0; i < keys.length; i++) {
          // Make sure both objects have the same sorting key
          if (a.hasOwnProperty(keys[i]) && !b.hasOwnProperty(keys[i])) {
            return 1
          }
          if (!a.hasOwnProperty(keys[i]) && b.hasOwnProperty(keys[i])) {
            return -1
          }
          // For objects who have the key, sort in the order defined in object.
          if (a[keys[i]] !== b[keys[i]]) {
            switch (fn[keys[i]].toString().trim().toLowerCase()) {
              case 'asc':
                return a[keys[i]] > b[keys[i]] ? 1 : -1
              case 'desc':
                return a[keys[i]] < b[keys[i]] ? 1 : -1
              default:
                if (typeof fn[keys[i]] === 'function') {
                  return fn[keys[i]](a, b)
                }
                return 0
            }
          }
        }
        // Everything is equal
        return 0
      })
    }
    this.reindex()
  }

  /**
   * @method createIndex
   * Add a simple index to the recordset.
   * @param {string} datafield
   * The #model data field to index.
   * @param {boolean} [suppressEvents=false]
   * Prevent events from firing on the creation of the index.
   * @fires index.create
   * Fired when an index is created. The datafield name and
   * store are supplied as an argument to event handlers.
   */
  createIndex (field, suppressEvents) {
    if (!this.model.hasOwnProperty(field)) {
      console.warn("The store's model does not contain a data field called " + field + '.')
    }
    let exists = this._index.hasOwnProperty(field)
    this._index[field] = this._index[field] || []
    !NGN.coalesce(suppressEvents, false) && !exists && this.emit('index.created', {field: field, store: this})
  }

  /**
   * @method deleteIndex
   * Remove an index.
   * @param {string} datafield
   * The #model data field to stop indexing.
   * @param {boolean} [suppressEvents=false]
   * Prevent events from firing on the removal of the index.
   * @fires index.delete
   * Fired when an index is deleted. The datafield name and
   * store are supplied as an argument to event handlers.
   */
  deleteIndex (field, suppressEvents) {
    if (this._index.hasOwnProperty(field)) {
      delete this._index[field]
      !NGN.coalesce(suppressEvents, false) && this.emit('index.created', {field: field, store: this})
    }
  }

  /**
   * @method clearIndices
   * Clear all indices from the indexes.
   */
  clearIndices () {
    let me = this
    Object.keys(this._index).forEach(function (key) {
      me._index[key] = []
    })
  }

  /**
   * @method deleteIndexes
   * Remove all indexes.
   * @param {boolean} [suppressEvents=true]
   * Prevent events from firing on the removal of each index.
   */
  deleteIndexes (suppressEvents) {
    suppressEvents = NGN.coalesce(suppressEvents, true)
    let me = this
    Object.keys(this._index).forEach(function (key) {
      me.deleteIndex(key, suppressEvents)
    })
  }

  /**
   * @method applyIndices
   * Apply the values to the index.
   * @param {NGN.DATA.Model} record
   * The record which should be applied to the index.
   * @param {number} number
   * The record index number.
   * @private
   */
  applyIndices (record, num) {
    let indexes = Object.keys(this._index)
    if (indexes.length === 0) {
      return
    }
    let me = this
    indexes.forEach(function (field) {
      if (record.hasOwnProperty(field)) {
        let values = me._index[field]
        // Check existing records for similar values
        for (let i = 0; i < values.length; i++) {
          if (values[i][0] === record[field]) {
            me._index[field][i].push(num)
            return
          }
        }
        // No matching words, create a new one.
        me._index[field].push([record[field], num])
      }
    })
  }

  /**
   * @method unapplyIndices
   * This removes a record from all relevant indexes simultaneously.
   * Commonly used when removing a record from the store.
   * @param  {number} indexNumber
   * The record index.
   * @private
   */
  unapplyIndices (num) {
    let me = this
    Object.keys(this._index).forEach(function (field) {
      let i = me._index[field].indexOf(num)
      if (i >= 0) {
        me._index[field].splice(i, 1)
      }
    })
  }

  /**
   * @method updateIndice
   * Update the index with new values.
   * @param  {string} fieldname
   * The name of the indexed field.
   * @param  {any} oldValue
   * The original value. This is used to remove the old value from the index.
   * @param  {any} newValue
   * The new value.
   * @param  {number} indexNumber
   * The number of the record index.
   * @private
   */
  updateIndice (field, oldValue, newValue, num) {
    if (!this._index.hasOwnProperty(field) || oldValue === newValue) {
      return
    }
    let ct = 0
    let me = this
    for (let i = 0; i < me._index[field].length; i++) {
      let value = me._index[field][i][0]
      if (value === oldValue) {
        me._index[field][i].splice(me._index[field][i].indexOf(num), 1)
        ct++
      } else if (newValue === undefined) {
        // If thr new value is undefined, the field was removed for the record.
        // This can be skipped.
        ct++
      } else if (value === newValue) {
        me._index[field][i].push(num)
        me._index[field][i].shift()
        me._index[field][i].sort()
        me._index[field][i].unshift(value)
        ct++
      }
      if (ct === 2) {
        return
      }
    }
  }

  /**
   * @method getIndices
   * Retrieve a list of index numbers pertaining to a field value.
   * @param  {string} field
   * Name of the data field.
   * @param  {any} value
   * The value of the index to match against.
   * @return {array}
   * Returns an array of integers representing the index where the
   * values exist in the record set.
   */
  getIndices (field, value) {
    if (!this._index.hasOwnProperty(field)) {
      return null
    }
    var indexes = this._index[field].filter(function (dataarray) {
      return dataarray.length > 0 && dataarray[0] === value
    })
    if (indexes.length === 1) {
      indexes[0].shift()
      return indexes[0]
    }
    return []
  }

  /**
   * @method reindex
   * Reindex the entire record set. This can be expensive operation.
   * Use with caution.
   * @private
   */
  reindex () {
    this.clearIndices()
    let me = this
    this._data.forEach(function (rec, i) {
      me.applyIndices(rec, i)
    })
  }
}

/**
 * indexes
 * An index consists of an object whose key is name of the
 * data field being indexed. The value is an array of record values
 * and their corresponding index numbers. For example:
 *
 * ```js
 * {
 *   "lastname": [["Butler", 0, 1, 3], ["Doe", 2, 4]]
 * }
 * ```
 * The above example indicates the store has two unique `lastname`
 * values, "Butler" and "Doe". Records containing a `lastname` of
 * "Butler" exist in the record store as the first, 2nd, and 4th
 * records. Records with the last name "Doe" are 3rd and 5th.
 * Remember indexes are zero based since records are stored as an
 * array.
 */

module.exports = Store
