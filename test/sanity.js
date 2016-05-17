'use strict'

let test = require('tape')

require('ngn')
require('../')

test('Namespace', function (t) {
  t.ok(NGN.DATA !== undefined, 'NGN.DATA is defined globally.')
  t.ok(typeof NGN.DATA === 'object', 'NGN.DATA exists.')
  t.ok(NGN.DATA.util !== undefined, 'NGN.DATA.util is defined globally.')
  t.ok(NGN.DATA.Model !== undefined, 'NGN.DATA.Model is defined globally.')
  t.ok(NGN.DATA.Store !== undefined, 'NGN.DATA.Model is defined globally.')
  t.end()
})

test('NGN.DATA.Model', function (t) {
  NGN.BUS.once('field.update', function (c) {
    t.ok(c.field === 'firstname', 'Event fired for data change.')
    t.ok(!c.old, 'Old value recognized.')
    t.ok(c.new === 'Corey', 'New value recognized.')

    p.addField('middle')
  })

  NGN.BUS.once('field.create', function () {
    t.ok(p.hasDataField('middle'), 'Data field added successfully.')
    p.removeField('middle')
  })

  NGN.BUS.once('field.remove', function () {
    t.ok(!p.hasDataField('middle'), 'Data field removed successfully.')
    p.firstname = 'change1'
    p.firstname = 'change2'
    p.undo(2)
    t.ok(p.firstname === 'Corey', 'Undo operation rolls back to a prior state.')
    let obj = p.serialize()
    t.ok(obj.firstname === 'Corey' && obj.hasOwnProperty('lastname'), 'Serialization works.')
    t.ok(p.data.gn === 'Corey', 'Data map works.')

    NGN.BUS.once('field.invalid', function () {
      t.ok(!p.valid && p.invalidDataAttributes.indexOf('val') >= 0, 'Validators work.')
      t.ok(p.data.hasOwnProperty('gn'), 'Record data mapping works.')

      let person = new Person({
        gn: 'Doug',
        sn: 'Adams'
      })
      t.ok(person.firstname === 'Doug', 'Load with a data map and autoconvert to friendly names.')

      let store = new NGN.DATA.Store({
        model: Person,
        index: ['firstname']
      })
      t.pass('New NGN.DATA.Store created.')
      t.ok(store._index.hasOwnProperty('firstname'), 'Indexing enabled.')

      store.add(p)
      t.ok(store.recordCount === 1, 'Added a new record via add(model)')

      store.allowDuplicates = true
      store.add({
        firstname: 'John',
        lastname: 'Doe'
      })
      t.ok(store.recordCount === 2, 'Converted raw data to model and added to store.')
      store.allowDuplicates = true

      t.ok(store.data[1].sn === 'Doe', 'Data mapping and record retrieval works.')
      store.remove(p)
      t.ok(store.recordCount === 1, 'Removed record by model.')
      t.ok(store.data[0].gn = 'Doe', 'Verified the removed record was the one supposed to be removed.')
      store.remove(0)
      t.ok(store.recordCount === 0, 'Removed record by index.')

      store.add({
        firstname: 'John',
        lastname: 'Doe2',
        testid: 'test'
      })

      store.add({
        firstname: 'John',
        lastname: 'Doe3'
      })

      t.ok(store.recordCount === 2, 'Added records after removal.')

      store.add({
        firstname: 'John',
        lastname: 'Doe3'
      })

      t.ok(store.recordCount === 3, 'Added duplicate without error.')
      store.deduplicate()

      t.ok(store.recordCount === 2, 'Store.deduplicate() removes duplicates.')

      t.ok(store.find(0).lastname === 'Doe2', 'Find by index.')
      t.ok(store.find(function (rec) { return rec.lastname === 'Doe2' })[0].lastname === 'Doe2', 'Find by filter function.')
      t.ok(store.find('test').lastname === 'Doe2', 'Find by ID.')

      store.load({
        firstname: 'The',
        lastname: 'Doctor'
      }, {
        firstname: 'Rose',
        lastname: 'Tyler'
      }, {
        firstname: 'Jack',
        lastname: 'Harkness'
      })
      t.ok(store.recordCount === 5, 'Data load() adds records.')

      store.reload({
        firstname: 'Rose',
        lastname: 'Tyler'
      }, {
        firstname: 'Jack',
        lastname: 'Harkness'
      }, {
        firstname: 'The',
        lastname: 'Doctor'
      })
      t.ok(store.recordCount === 3, 'Reload records.')

      store.addFilter(function (rec) {
        return rec.firstname.indexOf('e') >= 0
      })

      t.ok(store.records.length === 2, 'Basic filter.')

      store.addFilter(function (rec) {
        return rec.firstname === 'The'
      })

      t.ok(store.records.length === 1 && store.records[0].lastname === 'Doctor', 'Multiple filters.')

      store.clearFilters()
      t.ok(store.records.length === 3, 'Clear filters.')

      store.add({
        firstname: 'The',
        lastname: 'Master'
      })

      store.sort({
        firstname: 'desc',
        lastname: 'asc'
      })

      t.ok(store.find(0).lastname === 'Doctor', 'Sorting with multiple attributes.')
      store.sort({
        firstname: function (a, b) {
          if (a.firstname === 'The') {
            return -1
          }
          return a.firstname > b.firstname
        },
        lastname: 'asc'
      })

      t.ok(store.find(0).firstname === 'The' && store.find(1).lastname === 'Master', 'Complex sorting.')

      let query = store.find({
        firstname: 'The',
        val: 15
      })

      t.ok(query.length === 2 && query[0].firstname === 'The' && query[1].lastname === 'Master', 'Complex search with indexing returns proper results.')

      store.find(0).val = 10
      query = store.find({
        firstname: 'The',
        val: 15
      })

      t.ok(query.length === 1 && query[0].lastname === 'Master', 'Updated searching with mixed indexes returns proper results.')
      t.ok(store.indexOf(query[0]) === 1, 'Identify the index number of a specific record within the store.')
      t.ok(store.contains(query[0]), 'Store.contains(record) correctly identifies existance of a real record.')

      let dne = new Person({
        firstname: 'Fake',
        lastname: 'Person'
      })

      t.ok(!store.contains(dne), 'Store.contains(record) correctly indicates no record exists.')

      let proxy = new NGN.DATA.Proxy({
        store: store
      })
      t.ok(proxy.store instanceof NGN.DATA.Store, 'Proxy created with store.')
      t.ok(proxy.actions.create[0].lastname === 'Master', 'Creation tracked.')
      store.find(proxy.actions.create[0]).val = 12
      t.ok(proxy.actions.update.length === 0, 'Modifying a new record only triggers a creation action.')
      store.find(1).val = 13
      t.ok(proxy.actions.update.length === 1, 'Modifying an existing record triggers an update action.')
      store.remove(proxy.actions.create[0])
      // console.log(proxy.actions.create)
      t.ok(proxy.actions.create.length === 0, 'Deleting a created record neutralizes action.')

      store.add({
        firstname: 'The',
        lastname: 'Master'
      })

      store.clear()
      t.ok(store.recordCount === 0, 'Cleared all records.')

      store.add({
        firstname: 'The',
        lastname: 'Doctor'
      })
      store.add({
        firstname: 'The',
        lastname: 'DeveloperSpecial'
      })

      store.on('record.update', function (record) {
        if (record.lastname === 'DeveloperSpecial') {
          t.ok(record.firstname === 'Don', 'Record update event successfully triggered.')

          // Test ID autogeneration
          meta.autoid = true
          let TestModel = new NGN.DATA.Model(meta)
          let genid = new TestModel({
            firstname: 'fname'
          })
          t.ok(genid.testid.length === 36, 'Autogenerated ID with specified idAttribute.')
          let noid = new TestModel({
            testid: 'simpletest'
          })
          t.ok(noid.testid === 'simpletest', 'Do not autogenerate ID when an ID is explicitly defined.')
          delete meta.idAttribute
          let T2 = new NGN.DATA.Model(meta)
          let t2 = new T2({
            firstname: 'fname'
          })
          t.ok(t2.id.length === 36, 'Autogenerated ID with unspecified default id attribute.')
          t.end()
        }
      })
      store.records[1].firstname = 'Don'
    })

    p.val = 5
  })

  let meta = {
    idAttribute: 'testid',
    fields: {
      firstname: null,
      lastname: null,
      val: {
        min: 10,
        max: 20,
        default: 15
      },
      testid: null
    },
    dataMap: {
      firstname: 'gn',
      lastname: 'sn'
    }
  }

  let Person = new NGN.DATA.Model(meta)

  t.ok(typeof Person === 'function', 'Model creation works.')

  let p = new Person()
  t.ok(p !== undefined, 'Model instantiation works.')
  p.firstname = 'Corey'
})
