import {useCallback, useEffect, useState} from 'react'
import hash from './hash'

type Model = {
  constructor
  __observableId?: string
  hash?: () => string
}

class EventEmitter {
  callbacks = {}

  on(eventId, cb) {
    this.callbacks[eventId] = this.callbacks[eventId] || []
    this.callbacks[eventId].push(cb)
  }

  remove(eventId) {
    delete this.callbacks[eventId]
  }

  emit(eventId) {
    this.callbacks[eventId] && this.callbacks[eventId].forEach(cb => cb())
  }
}

const eventEmitter = new EventEmitter()

const id = () =>
  'xxxxxxxxxxxxxxxx'.replace(/[x]/g, () =>
    (
      (Math.floor(new Date().getTime() / 16) + Math.random() * 16) % 16 |
      (0 & 0x3) |
      0x8
    ).toString(16)
  )

function getAllFields(toCheck) {
  let props = []
  let obj = toCheck
  do {
    props = props.concat(Object.getOwnPropertyNames(obj))
  } while ((obj = Object.getPrototypeOf(obj)))
  return props.sort().filter((e, i, arr) => e != arr[i + 1])
}

function getObjectProxableFields(toCheck) {
  return getAllFields(toCheck).filter(e => typeof toCheck[e] !== 'function')
}

function getArrayProxableFields(toCheck) {
  const arrayProxableFields = ['push', 'pop', 'shift']

  return getAllFields(toCheck).filter(e => arrayProxableFields.includes(e))
}

function attachProxy(object, fieldName, originalField, id) {
  Object.defineProperty(object, fieldName, {
    configurable: true,
    enumerable: true,
    get: () => originalField,
    set: value => {
      originalField = value
      eventEmitter.emit(id)
    }
  })
}

function attachArrayProxy(object, fieldName, originalField, id) {
  function attachArrayMethodsProxy([method, ...rest]: string[]) {
    Object.defineProperty(object[fieldName], method, {
      configurable: true,
      enumerable: true,
      value: (...v) => {
        const result = Array.prototype[method].apply(object[fieldName], v)
        eventEmitter.emit(id)
        return result
      }
    })

    if (!rest.length) return
    return attachArrayMethodsProxy(rest)
  }

  return attachArrayMethodsProxy(getArrayProxableFields(object[fieldName]))
}

function isWritableField(object, fieldName) {
  const fieldDescriptor = Object.getOwnPropertyDescriptor(object, fieldName)
  return fieldDescriptor && fieldDescriptor.writable
}

function isObjectField(object, fieldName) {
  return (
    isWritableField(object, fieldName) && typeof object[fieldName] === 'object'
  )
}

function isPrimitiveField(object, fieldName) {
  return (
    isWritableField(object, fieldName) && typeof object[fieldName] !== 'object'
  )
}

function recursivelyAttachProxy(originalField, fieldName, object, id) {
  if (Array.isArray(object[fieldName])) {
    //Handling re-assigning whole array; this.array = [1,2,3]
    attachProxy(object, fieldName, originalField, id)
    return attachArrayProxy(object, fieldName, originalField, id)
  }
  if (isObjectField(object, fieldName))
    getObjectProxableFields(object[fieldName]).forEach(nestedFieldName =>
      recursivelyAttachProxy(
        object[fieldName][nestedFieldName],
        nestedFieldName,
        object[fieldName],
        id
      )
    )

  if (isPrimitiveField(object, fieldName))
    attachProxy(object, fieldName, originalField, id)
}

function attachProxyToProperties<T extends Model>(model: T) {
  getObjectProxableFields(model).forEach(field => {
    recursivelyAttachProxy(model[field], field, model, model.__observableId)
  })
}

function decorate<T extends Model>(model: T) {
  if (!model.__observableId)
    Object.defineProperty(model, '__observableId', {
      value: id(),
      writable: false
    })
  if (!model.hash) model.hash = () => hash(model)
}

function reactify<T extends Model>(model: T) {
  const [, stateChange] = useState(model.hash())

  const stateChangeCallback = useCallback(() => {
    stateChange(model.hash())
  }, [model.__observableId])

  useEffect(() => {
    eventEmitter.on(model.__observableId, stateChangeCallback)
    return () => eventEmitter.remove(model.__observableId)
  }, [model.__observableId])
}

function observe<T extends Model>(model: T): T {
  decorate(model)
  attachProxyToProperties(model)
  reactify(model)
  return model
}

export default observe
